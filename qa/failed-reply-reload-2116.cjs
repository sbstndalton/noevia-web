// #2116: a project-chat reply failed (the model took too long), the page showed the error with Retry, and after a reload the
// question stood alone: no reply, no error, no Retry. The failed reply is now saved with the transcript, so a reload shows
// the same failure with Retry on the last reply; Retry resends the question and replaces the failed turn; the saved failure
// is never sent to the model.
//
// Offline: synthetic stubs only. /api/chat and the transcript routes are answered by page.route, with a small in-memory
// transcript store that behaves like core's POST/GET /api/chats/:id/history (it keeps what the client saves, unchanged).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist dir> node qa/failed-reply-reload-2116.cjs
// Fails on a build without the change (the failure is gone after the reload), passes with it.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 32116);
const CHAT = 'fc2116';
const freeChats = [{ id: CHAT, title: 'Failed reply', updatedAt: 5000, archived: false, pinned: false }];
const QUESTION = 'QA-2116 summarise the synthetic notes';
const FAILURE_TEXT = 'The model took too long to unload, so the reply was ended. Try again.';
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS failed-reply-reload-2116: ${name}`); }
    catch (e) { failed++; console.log(`FAIL failed-reply-reload-2116: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    const store = { history: [], saves: 0 };
    const chatBodies = [];
    let replies = 0;
    const page = await browser.newPage(withLocale({ viewport: { width: 1280, height: 860 } }));
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
    await page.route('**/api/chats/*/history', async (r) => {
      if (r.request().method() === 'POST') {
        store.history = JSON.parse(r.request().postData()).history;
        store.saves++;
        return r.fulfill({ json: { ok: true, revision: `r${store.saves}` } });
      }
      return r.fulfill({ json: { history: store.history, revision: `r${store.saves}` } });
    });
    await page.route('**/api/chat', (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      chatBodies.push(JSON.parse(r.request().postData()));
      replies++;
      // The first reply fails the way a model that cannot be unloaded does; the retry answers.
      const events = replies === 1
        ? [{ type: 'meta', model: 'Synthetic-Chat-Q4' }, { type: 'error', text: FAILURE_TEXT }]
        : [{ type: 'meta', model: 'Synthetic-Chat-Q4' }, { type: 'delta', text: 'Synthetic answer after the retry.' }, { type: 'done', model: 'Synthetic-Chat-Q4' }];
      return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(events) });
    });
    const retry = () => page.locator('.msg-retry');
    const settle = () => page.waitForFunction(() => !document.querySelector('[title="Stop generating"]'), null, { timeout: 15000 });

    await page.goto(`http://localhost:${PORT}/c/${CHAT}`);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 20000 });
    await box.fill(QUESTION);
    await box.press('Enter');

    await check('the failed reply shows its error and Retry (as before)', async () => {
      await retry().waitFor({ timeout: 15000 });
      assert.equal(await retry().count(), 1);
      await page.getByText(/Reply failed|could not finish|too long to unload|Try again/i).first().waitFor({ timeout: 5000 });
    });
    await settle();
    // The save that follows the failed reply has reached the (stub) server.
    await check('the failed turn is saved with the transcript', async () => {
      await page.waitForTimeout(800);
      const last = store.history[store.history.length - 1];
      assert.deepEqual(store.history.map((e) => e.role), ['user', 'assistant'], `saved: ${JSON.stringify(store.history)}`);
      assert.ok(last && typeof last.failure === 'string' && last.failure.length > 0, 'the failure sentence is saved on the reply');
    });

    await page.reload();
    await box.waitFor({ timeout: 20000 });
    await check('after a reload the question is followed by the same failure, with Retry', async () => {
      await page.locator('.msg[data-role=user]').filter({ hasText: QUESTION }).waitFor({ timeout: 15000 });
      await retry().waitFor({ timeout: 10000 });
      assert.equal(await page.locator('.msg[data-role=assistant]').count(), 1, 'the failed reply is listed under the question');
      assert.equal(await page.locator('.msg[data-role=assistant] .bubble').count(), 0, 'it is a failure card, not an answer');
    });
    await check('Retry after the reload resends the question, replaces the failed turn, and the failure is not sent to the model', async () => {
      await retry().click();
      await page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'Synthetic answer after the retry.' }).waitFor({ timeout: 15000 });
      await settle();
      const second = chatBodies[1];
      assert.equal(second.message, QUESTION);
      assert.deepEqual((second.history || []).filter((m) => m.role === 'assistant' || String(m.content).includes('too long')), [], 'no failed turn in the history the model gets');
      assert.equal(await retry().count(), 0);
      await page.waitForTimeout(800);
      assert.deepEqual(store.history.map((e) => e.role), ['user', 'assistant']);
      assert.equal(store.history[1].failure, undefined, 'the answered turn replaced the failed one');
      assert.equal(store.history[1].content, 'Synthetic answer after the retry.');
    });
    await page.reload();
    await check('after the answered retry and a reload there is the answer and no failure', async () => {
      await page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: 'Synthetic answer after the retry.' }).waitFor({ timeout: 15000 });
      assert.equal(await retry().count(), 0);
    });
    await page.close();
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
