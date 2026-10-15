// #1785 reopen (live recheck of b84758dc): a chat whose FIRST reply was stopped kept its raw prompt as its title, even
// after a later follow-up reply completed and the server sent a generated title. The client judged "still auto-named"
// against the follow-up's text instead of the chat's first message, so the title was refused.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs). The page answers
// POST /api/chat itself: the first reply streams part of an answer and waits for Stop; the second completes, sends
// `done`, then the trailing `title` event core sends after done (core chat.cjs, web#58/#59).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/chat-title-after-stopped-1785.cjs
// Fails on a build without the change, passes with it.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31785);
const FIRST = 'QA-1785 explain synthetic photosynthesis in six paragraphs.';
const FOLLOW_UP = 'QA-1785 now list three synthetic octopus facts.';
const GENERATED = 'Synthetic Photosynthesis Notes';
const freeChats = [{ id: 'fc1785', title: FIRST, updatedAt: 5000, archived: false, pinned: false }];

function installChat({ title }) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.pathname !== '/api/chat' || (init.method || 'GET') !== 'POST') return realFetch(input, init);
    const calls = Number(sessionStorage.getItem('qa1785-calls') || 0);
    sessionStorage.setItem('qa1785-calls', String(calls + 1));
    const first = calls === 0;
    const enc = new TextEncoder();
    const event = (c, data) => c.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
    const stream = new ReadableStream({
      start(c) {
        event(c, { type: 'meta', model: 'Synthetic-Chat-Q4' });
        event(c, { type: 'delta', text: first ? 'Synthetic first paragraph that stops' : 'Synthetic fact one. Synthetic fact two. Synthetic fact three.' });
        if (first) { init.signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError'))); return; }
        event(c, { type: 'done', model: 'Synthetic-Chat-Q4' });
        setTimeout(() => { event(c, { type: 'title', chatId: 'fc1785', title }); c.close(); }, 300);
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  };
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = false;
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 2000, height: 1100 } }));
    const history = { list: [] };
    const metaSaves = [];
    await page.addInitScript(installChat, { title: GENERATED });
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
    await page.route('**/api/freechats', (r) => { if (r.request().method() === 'POST') metaSaves.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
    await page.route('**/api/chats/*/history', (r) => {
      if (r.request().method() === 'POST') { history.list = r.request().postDataJSON().history || []; return r.fulfill({ json: { ok: true, revision: `r${Date.now()}` } }); }
      return r.fulfill({ json: { history: history.list, revision: 'r1' } });
    });
    await page.goto(`http://localhost:${PORT}/c/fc1785`);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 20000 });
    await box.fill(FIRST); await box.press('Enter');
    await page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'that stops' }).waitFor({ timeout: 15000 });
    await page.getByTitle('Stop generating').click();
    await page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 10000 });
    await page.waitForTimeout(300);
    await box.fill(FOLLOW_UP); await box.press('Enter');
    await page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'Synthetic fact three' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const sidebar = page.getByRole('button', { name: GENERATED }).or(page.getByRole('link', { name: GENERATED })).or(page.getByText(GENERATED, { exact: true }));
    try {
      assert.ok(await sidebar.count() > 0, 'the sidebar shows the generated title');
      const saved = metaSaves.at(-1)?.chats?.find((c) => c.id === 'fc1785');
      assert.equal(saved?.title, GENERATED, 'the chat meta is saved with the generated title');
      console.log('PASS chat-title-after-stopped-1785: a stopped first reply, then a completed follow-up, takes the generated title');
    } catch (e) {
      failed = true;
      console.log(`FAIL chat-title-after-stopped-1785: ${e.message}`);
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
