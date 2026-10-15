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
const freeChats = [{ id: 'fc1784', title: 'Stopped partial', updatedAt: 5000, archived: false, pinned: false }];

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

async function open(browser, { width, height, theme }) {
  const saved = { history: [] };
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
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
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nchat-stopped-partial-1784: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
