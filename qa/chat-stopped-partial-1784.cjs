// #1784: a reply stopped after part of its answer had arrived kept its text but showed no sign it was
// stopped: the sender line, Copy and Regenerate looked exactly like a finished answer. A reply stopped
// before any text already said "Stopped before a reply was written." (#634, #1447). Now a partial reply
// keeps its text and its sender, and carries a quiet "Stopped before the reply finished." note, which
// is saved with the transcript (so a reload still shows it) and goes away when Regenerate replaces it.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
// The model stream is synthetic too: the page answers POST /api/chat itself. The first reply streams
// part of a sentence and then waits until Stop; any later reply (Regenerate) finishes normally.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] node qa/chat-stopped-partial-1784.cjs
// Fails on a build without the change, passes with it.
//
// Reopen (live recheck of b84758dc): the live server showed "This reply was interrupted before it finished."
// instead of the Stopped note. The live flow below reproduces it with a real HTTP stream from the fixture
// server that behaves like core: Stop aborts the request; core keeps observing the engine's next chunk (it
// only stops writing to the closed socket) and keeps the reply as an interrupted turn after the user message
// (#679, chat-interrupted-turn.cjs, used here as is); the history store checks revisions, so the client's
// save after Stop conflicts and is merged with the server's longer, interrupted copy.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31784);
const SHOTS = process.env.QA_SHOTS || '';
const PARTIAL = 'Synthetic photosynthesis answer, first paragraph. The second paragraph stops at the energy';
const COMPLETE = 'Synthetic complete answer after Regenerate.';
const NOTE = 'Stopped before the reply finished.';
const freeChats = [{ id: 'fc1784', title: 'Stopped partial', updatedAt: 5000, archived: false, pinned: false },
  { id: 'fc1784live', title: 'Stopped live stream', updatedAt: 4000, archived: false, pinned: false }];
const INTERRUPTED = 'This reply was interrupted before it finished.';
const UNSEEN = ' UNSEEN-AFTER-STOP';
const LIVE_PROMPT = 'QA-1784 live list 40 numbered facts about octopuses';
const DROP_PROMPT = 'QA-1784 DROP list 40 numbered facts about octopuses';
const { createTurnRecord } = require(path.join(process.env.QA_CORE_SERVER || path.join(__dirname, '../../noevia-core/server'), 'chat-interrupted-turn.cjs'));

// The live flow's server side: /api/chat streams over real HTTP until the client aborts, and the chat's history
// is stored with revisions (409 with the stored copy on a stale save), as core does.
function installLiveServer(fixture) {
  const store = { history: [], rev: 1 };
  const original = fixture.server.listeners('request');
  fixture.server.removeAllListeners('request');
  const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  fixture.server.on('request', async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const isHistory = url.pathname === '/api/chats/fc1784live/history';
    const isChat = url.pathname === '/api/chat' && req.method === 'POST';
    if (!isHistory && !isChat) { for (const fn of original) fn.call(fixture.server, req, res); return; }
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    if (isHistory) {
      // The live client saves through the tunnel; the server sees the aborted stream first. A save waits one
      // simulated round trip, so the order is the live one and not a race on loopback.
      if (req.method === 'POST') await new Promise((r) => setTimeout(r, 400));
      if (req.method !== 'POST') return json(res, { history: store.history, revision: `r${store.rev}` });
      if (body.baseRevision && body.baseRevision !== `r${store.rev}`) return json(res, { history: store.history, revision: `r${store.rev}` }, 409);
      store.history = Array.isArray(body.history) ? body.history : [];
      store.rev++;
      return json(res, { ok: true, revision: `r${store.rev}` });
    }
    if (body.chatId !== 'fc1784live') { for (const fn of original) fn.call(fixture.server, Object.assign(req, { [Symbol.asyncIterator]: async function* () { yield raw; } }), res); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const record = createTurnRecord();
    let closed = false;
    // core chat.cjs send(): observe every event, write only while the client is still there.
    const send = (obj) => { record.observe(obj); if (!closed && !res.destroyed) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    send({ type: 'meta', model: 'Synthetic-Chat-Q4', route: 'Fast' });
    send({ type: 'reasoning', text: 'Synthetic plan: list the facts.' });
    let n = 0;
    // A message with DROP has its connection cut by the server side (a tunnel drop), not stopped by the person.
    const drop = String(body.message).includes('DROP');
    const timer = setInterval(() => {
      n++; send({ type: 'delta', text: `${n === 1 ? '' : '\n'}${n}. Synthetic octopus fact number ${n}.` });
      if (drop && n === 8) res.destroy(); else if (n >= 400) clearInterval(timer);
    }, 60);
    res.on('close', () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      // The engine's next chunk lands before the upstream abort does: core still observes it, the client never sees it.
      send({ type: 'delta', text: UNSEEN });
      // #679: keep the reply after the user message, unless the client already saved past it.
      const last = store.history[store.history.length - 1];
      const entry = record.partialEntry() || record.assistantEntry();
      if (entry && last && last.role === 'user' && last.content === body.message) { store.history = [...store.history, entry]; store.rev++; }
    });
  });
  return store;
}


// Runs in the page: the first /api/chat streams a partial answer and holds the stream open until the
// request is aborted (Stop); every later one streams a complete answer.
function installChat({ partial, complete }) {
  const realFetch = window.fetch.bind(window);
  // Counted across reloads: a reload must not make the next reply a partial one again.
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname !== '/api/chat' || (init.method || 'GET') !== 'POST') return realFetch(input, init);
    const calls = Number(sessionStorage.getItem('qa1784-calls') || 0);
    sessionStorage.setItem('qa1784-calls', String(calls + 1));
    const first = calls === 0;
    const enc = new TextEncoder();
    const event = (c, data) => c.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
    const stream = new ReadableStream({
      start(c) {
        event(c, { type: 'meta', model: 'Synthetic-Chat-Q4' });
        event(c, { type: 'delta', text: first ? partial : complete });
        if (!first) { event(c, { type: 'done', model: 'Synthetic-Chat-Q4' }); c.close(); return; }
        init.signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  };
}

async function open(browser, { width, height, theme, live = false }) {
  const saved = { history: [] };
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
  if (live) {
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
    await page.goto(`http://localhost:${PORT}/c/fc1784live`);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 20000 });
    return { page, box };
  }
  await page.addInitScript(installChat, { partial: PARTIAL, complete: COMPLETE });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() || {};
      saved.history = Array.isArray(body.history) ? body.history : [];
      return r.fulfill({ json: { ok: true, revision: `r${Date.now()}` } });
    }
    return r.fulfill({ json: { history: saved.history, revision: 'r1' } });
  });
  await page.goto(`http://localhost:${PORT}/c/fc1784`);
  const box = page.getByRole('textbox', { name: 'Message', exact: true });
  await box.waitFor({ timeout: 20000 });
  return { page, saved, box };
}

async function stopPartway(page, box) {
  await box.fill('QA-1784 explain photosynthesis in six paragraphs');
  await box.press('Enter');
  await page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'stops at the energy' }).waitFor({ timeout: 15000 });
  await page.getByTitle('Stop generating').click();
  await page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(400);
}

const lastReply = (page) => page.locator('.msg[data-role=assistant]').last();

(async () => {
  const fixture = createFixture(PORT);
  const liveStore = installLiveServer(fixture);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS chat-stopped-partial-1784: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL chat-stopped-partial-1784: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  try {
    for (const [width, height, theme] of [[2000, 1100, 'light'], [2000, 1100, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
      const tag = `${width} px ${theme}`;
      const { page, saved, box } = await open(browser, { width, height, theme });
      await stopPartway(page, box);

      await check(`#1784 ${tag}: a reply stopped partway keeps its text and says it was stopped`, async () => {
        const reply = lastReply(page);
        assert.ok((await reply.locator('.bubble').innerText()).includes(PARTIAL), 'the partial text is kept');
        const note = reply.getByTestId('reply-stopped');
        assert.equal(await note.count(), 1, 'the stopped reply carries a Stopped note');
        assert.equal((await note.innerText()).trim(), NOTE);
        assert.ok(await note.isVisible(), 'the note is visible');
        const sender = (await reply.locator('.msg-sender.is-assistant').innerText()).replace(/\s+/g, ' ').trim();
        assert.ok(!/·\s*Stopped$/.test(sender), `the sender still names the model, not the Stopped placeholder: ${sender}`);
        // Quiet: secondary text, smaller than the answer text.
        const style = await page.evaluate(() => {
          const n = document.querySelector('[data-testid=reply-stopped]');
          const body = n.closest('.bubble').querySelector('p:not([data-testid])');
          const cs = getComputedStyle(n);
          return { size: parseFloat(cs.fontSize), bodySize: parseFloat(getComputedStyle(body).fontSize), color: cs.color, bodyColor: getComputedStyle(body).color };
        });
        assert.ok(style.size < style.bodySize, `the note is smaller than the answer (${style.size} vs ${style.bodySize})`);
        assert.notEqual(style.color, style.bodyColor, 'the note uses the secondary text colour');
        if (SHOTS) {
          await reply.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1784-stopped-${width}-${theme}.png`) });
        }
      });

      await check(`#1784 ${tag}: Copy and Regenerate are still offered`, async () => {
        const reply = lastReply(page);
        assert.equal(await reply.getByRole('button', { name: 'Copy' }).count(), 1);
        assert.equal(await reply.getByRole('button', { name: 'Regenerate' }).count(), 1);
      });

      await check(`#1784 ${tag}: the stopped mark is saved and shown again after a reload`, async () => {
        const entry = saved.history.filter((h) => h.role === 'assistant').at(-1);
        assert.ok(entry, 'the reply was saved');
        assert.equal(entry.content, PARTIAL);
        assert.equal(entry.stopped, true, 'the saved reply is marked stopped');
        await page.reload();
        await lastReply(page).waitFor({ timeout: 20000 });
        assert.equal(await lastReply(page).getByTestId('reply-stopped').count(), 1, 'the note is shown after a reload');
      });

      await check(`#1784 ${tag}: Regenerate replaces the stopped reply with a finished one, without the note`, async () => {
        await lastReply(page).getByRole('button', { name: 'Regenerate' }).click();
        await lastReply(page).locator('.bubble').filter({ hasText: COMPLETE }).waitFor({ timeout: 15000 });
        await page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 10000 });
        assert.equal(await lastReply(page).getByTestId('reply-stopped').count(), 0, 'a finished reply has no Stopped note');
        await page.waitForTimeout(400);
        const entry = saved.history.filter((h) => h.role === 'assistant').at(-1);
        assert.equal(entry.content, COMPLETE);
        assert.notEqual(entry.stopped, true, 'the finished reply is not saved as stopped');
      });

      await check(`#1784 ${tag}: the earlier, stopped answer still says so when shown again`, async () => {
        const prev = page.getByRole('button', { name: 'Previous answer' }).last();
        await prev.click();
        await lastReply(page).locator('.bubble').filter({ hasText: 'stops at the energy' }).waitFor({ timeout: 5000 });
        assert.equal(await lastReply(page).getByTestId('reply-stopped').count(), 1);
      });
      await page.close();

      // Reopen: the live flow, a real stream aborted midway, the server keeping its interrupted copy.
      liveStore.history = []; liveStore.rev = 1;
      const live = await open(browser, { width, height, theme, live: true });
      await live.box.fill(LIVE_PROMPT);
      await live.box.press('Enter');
      await live.page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'fact number 6.' }).waitFor({ timeout: 15000 });
      await live.page.getByTitle('Stop generating').click();
      await live.page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 10000 });
      await live.page.waitForTimeout(1500);

      await check(`#1784 live ${tag}: a Stop on a real stream shows exactly one Stopped note and no interrupted note`, async () => {
        const reply = lastReply(live.page);
        assert.equal(await reply.getByTestId('reply-stopped').count(), 1, 'one Stopped note');
        assert.equal((await reply.getByTestId('reply-stopped').innerText()).trim(), NOTE);
        assert.equal(await reply.locator('.msg-interrupted').count(), 0, 'no interrupted note beside it');
        assert.ok(!(await reply.innerText()).includes(INTERRUPTED), 'the interrupted copy is not shown');
        assert.ok(!(await reply.innerText()).includes(UNSEEN.trim()), 'text the engine produced after Stop is not shown');
        if (SHOTS) {
          await reply.scrollIntoViewIfNeeded();
          await live.page.screenshot({ path: path.join(SHOTS, `1784-live-stopped-${width}-${theme}.png`) });
        }
      });

      await check(`#1784 live ${tag}: the saved transcript keeps the stopped reply, not the server's interrupted copy`, async () => {
        const entry = liveStore.history.filter((h) => h.role === 'assistant').at(-1);
        assert.ok(entry, 'the reply was saved');
        assert.equal(entry.stopped, true, 'saved as stopped');
        assert.notEqual(entry.interrupted, true, 'not saved as interrupted');
        assert.ok(!entry.content.includes(UNSEEN.trim()), 'the unseen text is not saved');
        assert.equal(liveStore.history.filter((h) => h.role === 'assistant').length, 1, 'one reply, roles still alternate');
        await live.page.reload();
        await lastReply(live.page).waitFor({ timeout: 20000 });
        await live.page.waitForTimeout(500);
        assert.equal(await lastReply(live.page).getByTestId('reply-stopped').count(), 1, 'the Stopped note after a reload');
        assert.equal(await lastReply(live.page).locator('.msg-interrupted').count(), 0, 'no interrupted note after a reload');
      });
      await live.page.close();

      // Review of web#61: a connection the server side drops is NOT a Stop. The reply is the server's kept copy,
      // with the interrupted note and Retry/Continue, and no Stopped note.
      liveStore.history = []; liveStore.rev = 1;
      const dropped = await open(browser, { width, height, theme, live: true });
      await dropped.box.fill(DROP_PROMPT);
      await dropped.box.press('Enter');
      await dropped.page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 15000 });
      await dropped.page.waitForTimeout(1500);
      await check(`#1784 dropped ${tag}: a dropped connection keeps the server's interrupted copy, never a Stopped note`, async () => {
        const entry = liveStore.history.filter((h) => h.role === 'assistant').at(-1);
        assert.ok(entry, 'the server kept the reply');
        assert.equal(entry.interrupted, true, 'saved as interrupted');
        assert.notEqual(entry.stopped, true, 'not saved as stopped');
        // The chat is reloaded the way a person returns to it after the error.
        await dropped.page.reload();
        await lastReply(dropped.page).waitFor({ timeout: 20000 });
        await dropped.page.waitForTimeout(500);
        const reply = lastReply(dropped.page);
        assert.equal(await reply.getByTestId('reply-stopped').count(), 0, 'no Stopped note');
        assert.equal(await reply.locator('.msg-interrupted').count(), 1, 'one interrupted note');
        assert.ok((await reply.innerText()).includes(INTERRUPTED));
        assert.equal(await reply.getByRole('button', { name: /Retry/ }).count() >= 1, true, 'Retry is offered');
        if (SHOTS) {
          await reply.scrollIntoViewIfNeeded();
          await dropped.page.screenshot({ path: path.join(SHOTS, `1784-dropped-${width}-${theme}.png`) });
        }
      });
      await dropped.page.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nchat-stopped-partial-1784: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
