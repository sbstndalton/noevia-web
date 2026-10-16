// #1896: Stop, then an immediate new turn. While the engine finished the stopped reply (or a short maintenance step), the
// server answered POST /api/chat with a bare 503 and the turn failed. Core now waits briefly itself and, when it still must
// refuse, answers 503 { code: 'inferenceMaintenance', retryable: true, retryAfter }. The client retries that once, quietly;
// a second refusal reads "Still finishing the previous reply. Try again in a moment.".
// Offline: synthetic stubs only (diary-fixture.cjs); /api/chat is answered by page.route.
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist dir> node qa/chat-503-retry-1896.cjs
// Fails on a build of main (the 503 is shown as a failure), passes with the change.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31896);
const freeChats = [{ id: 'fc1896', title: 'Busy after Stop', updatedAt: 5000, archived: false, pinned: false }];
const BUSY = { error: 'Chat is paused while noevia applies a model setting.', code: 'inferenceMaintenance', retryable: true, retryAfter: 1 };
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

async function run(browser, { refusals }) {
  const calls = [];
  const page = await browser.newPage(withLocale({ viewport: { width: 1280, height: 860 } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: r.request().method() === 'POST' ? { ok: true, revision: `r${Date.now()}` } : { history: [], revision: 'r1' } }));
  let refused = 0;
  await page.route('**/api/chat', (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    calls.push(Date.now());
    if (calls.length === 1) return; // the first reply never answers: the person presses Stop
    if (refused < refusals) { refused++; return r.fulfill({ status: 503, headers: { 'Retry-After': '1' }, json: BUSY }); }
    return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse([{ type: 'meta', model: 'Synthetic-Chat-Q4' }, { type: 'delta', text: 'Synthetic answer after the retry.' }, { type: 'done', model: 'Synthetic-Chat-Q4' }]) });
  });
  await page.goto(`http://localhost:${PORT}/c/fc1896`);
  const box = page.getByRole('textbox', { name: 'Message', exact: true });
  await box.waitFor({ timeout: 20000 });
  await box.fill('QA-1896 first question');
  await box.press('Enter');
  await page.getByTitle('Stop generating').click();
  await page.getByTitle('Stop generating').waitFor({ state: 'detached', timeout: 10000 });
  await box.fill('QA-1896 immediate second question');
  await box.press('Enter');
  return { page, calls };
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS chat-503-retry-1896: ${name}`); }
    catch (e) { failed++; console.log(`FAIL chat-503-retry-1896: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    await check('Stop, then an immediate turn that is refused once succeeds on the automatic retry', async () => {
      const { page, calls } = await run(browser, { refusals: 1 });
      try {
        await page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'Synthetic answer after the retry.' }).waitFor({ timeout: 15000 });
        assert.equal(calls.length, 3, 'first turn, the refused turn, one retry');
        assert.equal(await page.getByText(/Chat is paused|Still finishing|request failed/i).count(), 0, 'no error is shown');
      } finally { await page.close(); }
    });
    await check('a turn refused twice says the previous reply is still finishing, after exactly one retry', async () => {
      const { page, calls } = await run(browser, { refusals: 5 });
      try {
        await page.getByText('Still finishing the previous reply. Try again in a moment.').first().waitFor({ timeout: 15000 });
        assert.equal(calls.length, 3, 'exactly one automatic retry');
      } finally { await page.close(); }
    });
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
