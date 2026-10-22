// #2116: a project-chat reply failed (the model took too long), the page showed the error with Retry, and after a reload the
// question stood alone: no reply, no error, no Retry. The failed reply is now saved with the transcript, so a reload shows
// the same failure with Retry on the last reply; Retry resends the question and replaces the failed turn; a new message
// sent instead leaves the failed turn in the transcript without Retry; the saved failure and any text that had streamed in
// before it are never sent to the model.
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
const SECOND = 'QA-2116 a different question';
const FAILURE_TEXT = 'The model took too long to unload, so the reply was ended. Try again.';
const PARTIAL = 'QA-2116 partial text that streamed in before the failure';
const ANSWER = 'Synthetic answer after the retry.';
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

  // One chat page with a stub server. `firstReply` are the stream events of the first reply (it fails); later replies answer.
  const open = async (firstReply) => {
    const store = { history: [], saves: 0 };
    const chatBodies = [];
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
      const events = chatBodies.length === 1 ? firstReply
        : [{ type: 'meta', model: 'Synthetic-Chat-Q4' }, { type: 'delta', text: ANSWER }, { type: 'done', model: 'Synthetic-Chat-Q4' }];
      return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse(events) });
    });
    await page.goto(`http://localhost:${PORT}/c/${CHAT}`);
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.waitFor({ timeout: 20000 });
    return { page, store, chatBodies, box, retry: page.locator('.msg-retry'),
      settle: () => page.waitForFunction(() => !document.querySelector('[title="Stop generating"]'), null, { timeout: 15000 }),
      send: async (text) => { await box.fill(text); await box.press('Enter'); } };
  };
  const failing = (withPartial) => [{ type: 'meta', model: 'Synthetic-Chat-Q4' }, ...(withPartial ? [{ type: 'delta', text: PARTIAL }] : []), { type: 'error', text: FAILURE_TEXT }];
  const modelSaw = (body) => JSON.stringify(body.history || []);

  try {
    // 1. No text before the failure: reload, then Retry.
    const a = await open(failing(false));
    await a.send(QUESTION);
    await check('the failed reply shows its error and Retry (as before)', async () => {
      await a.retry.waitFor({ timeout: 15000 });
      assert.equal(await a.retry.count(), 1);
    });
    await a.settle();
    await check('the failed turn is saved with the transcript', async () => {
      await a.page.waitForTimeout(800);
      const last = a.store.history[a.store.history.length - 1];
      assert.deepEqual(a.store.history.map((e) => e.role), ['user', 'assistant'], `saved: ${JSON.stringify(a.store.history)}`);
      assert.ok(last && typeof last.failure === 'string' && last.failure.length > 0, 'the failure sentence is saved on the reply');
    });
    await a.page.reload();
    await a.box.waitFor({ timeout: 20000 });
    await check('after a reload the question is followed by the same failure, with Retry', async () => {
      await a.page.locator('.msg[data-role=user]').filter({ hasText: QUESTION }).waitFor({ timeout: 15000 });
      await a.retry.waitFor({ timeout: 10000 });
      assert.equal(await a.page.locator('.msg[data-role=assistant]').count(), 1, 'the failed reply is listed under the question');
      assert.equal(await a.page.locator('.msg[data-role=assistant] .bubble').count(), 0, 'it is a failure card, not an answer');
    });
    await check('Retry after the reload resends the question, replaces the failed turn, and the failure is not sent to the model', async () => {
      await a.retry.click();
      await a.page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: ANSWER }).waitFor({ timeout: 15000 });
      await a.settle();
      const second = a.chatBodies[1];
      assert.equal(second.message, QUESTION);
      assert.deepEqual((second.history || []).filter((m) => m.role === 'assistant' || String(m.content).includes('too long')), [], 'no failed turn in the history the model gets');
      assert.equal(await a.retry.count(), 0);
      await a.page.waitForTimeout(800);
      assert.deepEqual(a.store.history.map((e) => e.role), ['user', 'assistant']);
      assert.equal(a.store.history[1].failure, undefined, 'the answered turn replaced the failed one');
      assert.equal(a.store.history[1].content, ANSWER);
    });
    await a.page.reload();
    await check('after the answered retry and a reload there is the answer and no failure', async () => {
      await a.page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: ANSWER }).waitFor({ timeout: 15000 });
      assert.equal(await a.retry.count(), 0);
    });
    await a.page.close();

    // 2. Text streamed in before the failure: it survives the reload, and a NEW message (not Retry) never sends it on.
    const b = await open(failing(true));
    await b.send(QUESTION);
    await b.retry.waitFor({ timeout: 15000 });
    await b.settle();
    await b.page.waitForTimeout(800);
    await check('streamed text before the failure is saved with it', async () => {
      assert.equal(b.store.history[1].content, PARTIAL);
      assert.ok(b.store.history[1].failure);
    });
    await b.page.reload();
    await b.box.waitFor({ timeout: 20000 });
    await check('after a reload the partial text is shown with the failure and Retry', async () => {
      await b.retry.waitFor({ timeout: 15000 });
      await b.page.getByText(PARTIAL).first().waitFor({ timeout: 5000 });
    });
    await check('a new message after the reload keeps the failed turn (without Retry) and sends neither its text nor the failure to the model', async () => {
      await b.send(SECOND);
      await b.page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: ANSWER }).waitFor({ timeout: 15000 });
      await b.settle();
      const body = b.chatBodies[1];
      assert.equal(body.message, SECOND);
      assert.ok(!modelSaw(body).includes(PARTIAL), `the partial text reached the model: ${modelSaw(body)}`);
      assert.ok(!modelSaw(body).includes('too long'), 'the failure sentence reached the model');
      assert.equal(await b.retry.count(), 0, 'only the last reply offers Retry');
      await b.page.waitForTimeout(800);
      assert.deepEqual(b.store.history.map((e) => e.role), ['user', 'assistant', 'user', 'assistant']);
      assert.ok(b.store.history[1].failure, 'the failed turn stays in the transcript');
    });
    await b.page.reload();
    await check('after another reload the failure is still listed above the answered question', async () => {
      await b.page.locator('.msg[data-role=assistant] .bubble').filter({ hasText: ANSWER }).waitFor({ timeout: 15000 });
      await b.page.getByText(PARTIAL).first().waitFor({ timeout: 5000 });
      assert.equal(await b.retry.count(), 0);
    });
    await b.page.close();
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
