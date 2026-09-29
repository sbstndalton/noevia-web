// #666/#667: a declined write ends the reply with a fixed note, and a reply that ended on a note
// with no text (supervision pause, saved change, declined write) keeps Regenerate after a reload,
// without a Copy button. Isolated UI fixture (qa/diary-fixture.cjs) plus page.route mocks with
// synthetic saved chats; no server, model or storage. Synthetic data only.
//
// A: a reloaded chat whose last reply is a supervision pause after a read-only project_read_file
//    ("…Nothing was changed.", no text) shows Regenerate and no Copy; Regenerate re-sends the same
//    question with nothing before it (a plain retry: nothing was changed).
// B: a reloaded chat whose last reply is "1 change was saved…" shows Regenerate; the re-run carries
//    the record of the saved change (applied), so the write is reported as done, not replayed.
// C: the model proposes an append again and the person declines (the stream the server now sends):
//    the reply reads "No change was made: you declined project_append_file.", the tool row reads
//    "1 declined", Regenerate is offered, and the note is saved with the chat (not as its text),
//    survives a reload, and is never sent to the model on the next turn.
//
// FAILS on origin/main (no Regenerate on a text-less reply; the declined note reads as a
// supervision pause), PASSES with the fix.
// Run: npm run build -- --outDir <dir>; QA_DIST=<dir> PLAYWRIGHT_MODULE=<playwright-core> node qa/decline-pause-666-667.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31667), origin = `http://localhost:${PORT}`;
const FILE = 'qa-live-r13-notes.md', TARGET = `noevia projects/QA 667 Project/Text/${FILE}`;
const APPEND_ARGS = JSON.stringify({ name: FILE, text: 'Zusatz: 2' });
const DECLINED = 'ERROR: the user declined to run project_append_file. Do not retry it; ask what they would prefer.';
const DECLINED_NOTE = 'No change was made: you declined project_append_file.';

const saved = {
  'qa-667-paused': [
    { role: 'user', content: 'Say hello in three words.' },
    { role: 'assistant', content: '', model: 'Assistant · Auto (fast)', toolCalls: [{ name: 'project_read_file', args: JSON.stringify({ name: FILE }), status: 'done', result: 'Zahl: 1' }], paused: { reason: 'supervision', applied: 0 } },
  ],
  'qa-667-saved': [
    { role: 'user', content: `Please append the line "Zusatz: 2" to ${FILE}.` },
    { role: 'assistant', content: '', model: 'Assistant · Auto (fast)', toolCalls: [{ name: 'project_append_file', args: APPEND_ARGS, status: 'done', applied: true, target: TARGET, result: `Appended 10 chars to "${TARGET}".` }], paused: { reason: 'supervision', applied: 1 } },
  ],
  'qa-666-declined': [
    { role: 'user', content: `Please append the line "Zusatz: 2" to ${FILE}.` },
    { role: 'assistant', content: `Done: "Zusatz: 2" is now the last line of ${FILE}.`, model: 'Assistant · Auto (fast)', toolCalls: [{ name: 'project_append_file', args: APPEND_ARGS, status: 'done', applied: true, target: TARGET, result: `Appended 10 chars to "${TARGET}".` }] },
  ],
};
const posted = {}; // chat id -> the last history the client saved
const chatRequests = [];

const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  let failed = false;
  try {
    const ctx = await browser.newContext(withLocale({ viewport: { width: 1400, height: 900 } }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://**/*', (r) => r.abort());
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [
      { id: 'qa-667-paused', title: 'QA 667 paused', updatedAt: 3000 },
      { id: 'qa-667-saved', title: 'QA 667 saved', updatedAt: 2000 },
      { id: 'qa-666-declined', title: 'QA 666 declined', updatedAt: 1000 },
    ] } }));
    await page.route('**/api/freechats', (r) => r.fulfill({ json: { ok: true } }));
    await page.route('**/api/chats/*/history', async (r) => {
      const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
      if (r.request().method() === 'POST') { posted[id] = r.request().postDataJSON().history; return r.fulfill({ json: { ok: true, revision: `rev-${Date.now()}` } }); }
      return r.fulfill({ json: { history: posted[id] || saved[id] || [], revision: 'rev-0' } });
    });
    await page.route('**/api/chat', async (r) => {
      const body = r.request().postDataJSON();
      chatRequests.push(body);
      let events;
      if (/once more anyway/.test(body.message)) {
        // What the server sends once the person clicked Decline (#666): the card, the declined
        // result, the fixed pause and the end. No model text after the decline.
        events = [
          { type: 'tool', index: 0, name: 'project_append_file', args: APPEND_ARGS },
          { type: 'tool_pending', id: 'ap-qa-666', index: 0, name: 'project_append_file', args: APPEND_ARGS, target: TARGET, repeatOf: true },
          { type: 'tool_result', index: 0, name: 'project_append_file', text: DECLINED, declined: true },
          { type: 'paused', reason: 'declined', applied: 0, declined: ['project_append_file'], text: DECLINED_NOTE },
          { type: 'telemetry', phase: 'complete', model: 'synthetic-model' },
          { type: 'done', model: 'synthetic-model' },
        ];
      } else {
        events = [{ type: 'delta', text: 'Synthetic regenerated answer.' }, { type: 'done', model: 'synthetic-model' }];
      }
      return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: sse(events) });
    });

    const lastReply = () => page.locator('.msg[data-role="assistant"]').last();
    const actions = (reply) => ({
      regenerate: reply.getByRole('button', { name: 'Regenerate', exact: true }),
      copy: reply.getByRole('button', { name: 'Copy', exact: true }),
      retry: reply.locator('.msg-retry'),
    });
    const open = async (id) => {
      await page.goto(`${origin}/c/${id}`);
      await page.locator('[data-testid="reply-paused"], .msg[data-role="assistant"] .bubble').first().waitFor({ timeout: 15000 });
    };

    // Each scenario runs on its own, so a build that fails one still reports the others.
    const scenario = async (name, run) => {
      try { await run(); } catch (e) { failed = true; console.log(`FAIL ${name}: ` + String(e.message).split('\n').slice(0, 6).join('\n     ')); }
    };
    let reply, a, sent;

    // ── A: supervision pause after a read-only call, reloaded ──
    await scenario('A (#667 supervision pause)', async () => {
      await open('qa-667-paused');
      reply = lastReply();
      assert.equal((await reply.locator('[data-testid="reply-paused"]').innerText()).trim(), 'Step supervision paused this reply before any further steps. Nothing was changed.');
      a = actions(reply);
      assert.equal(await a.regenerate.count(), 1, 'A: the paused reply offers Regenerate after a reload');
      assert.equal(await a.copy.count(), 0, 'A: no Copy on a reply with no text');
      assert.equal(await a.retry.count(), 0, 'A: not an error, so no error Retry');
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/667-paused-regenerate.png` });
      await a.regenerate.click();
      await page.getByText('Synthetic regenerated answer.').waitFor({ timeout: 10000 });
      sent = chatRequests.at(-1);
      assert.equal(sent.message, 'Say hello in three words.', 'A: Regenerate re-sends the same question');
      assert.equal(sent.history.length, 0, 'A: nothing was changed, so it is a plain re-run with nothing before it');
      console.log('PASS A: a supervision pause with no text keeps Regenerate (no Copy) after a reload; it re-runs the question plainly');
    });

    // ── B: "1 change was saved…", reloaded ──
    await scenario('B (#667 saved change)', async () => {
      await open('qa-667-saved');
      reply = lastReply();
      assert.equal((await reply.locator('[data-testid="reply-paused"]').innerText()).trim(), '1 change was saved. Step supervision paused this reply before any further steps.');
      a = actions(reply);
      assert.equal(await a.regenerate.count(), 1, 'B: a reply that saved a change offers Regenerate');
      assert.equal(await a.copy.count(), 0, 'B: no Copy on a reply with no text');
      await a.regenerate.click();
      await page.getByText('Synthetic regenerated answer.').waitFor({ timeout: 10000 });
      sent = chatRequests.at(-1);
      assert.deepEqual(sent.history.map((h) => [h.role, h.applied === true]), [['user', false], ['assistant', false], ['tool', true]],
        'B: the re-run carries the record of the saved change: ' + JSON.stringify(sent.history));
      assert.equal(sent.history[2].target, TARGET);
      console.log('PASS B: "1 change was saved" keeps Regenerate; the re-run tells the model the change is done (applied record), nothing replays it');
    });

    // ── C: a declined write ──
    await scenario('C (#666 declined write)', async () => {
      await open('qa-666-declined');
      const box = page.getByRole('textbox', { name: 'Message', exact: true });
      await box.fill(`I know. Please append "Zusatz: 2" to ${FILE} once more anyway.`);
      await page.keyboard.press('Enter');
      reply = lastReply();
      await reply.locator('[data-testid="reply-paused"]').waitFor({ timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector('.typing'), null, { timeout: 10000 }).catch(() => {});
      assert.equal((await reply.locator('[data-testid="reply-paused"]').innerText()).trim(), DECLINED_NOTE, 'C: the fixed declined note');
      assert.match(await reply.locator('.tool-calls > summary').innerText(), /1 tool call[\s\S]*1 declined/, 'C: the tool row still reads 1 declined');
      assert.equal(await reply.locator('.bubble').count(), 0, 'C: no reply text claiming the change was made');
      a = actions(reply);
      assert.equal(await a.regenerate.count(), 1, 'C: the declined reply offers Regenerate');
      assert.equal(await a.copy.count(), 0, 'C: no Copy on a reply with no text');
      if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/666-declined-note.png` });
      for (let i = 0; i < 60 && !(posted['qa-666-declined'] || []).some((h) => h.paused); i++) await page.waitForTimeout(50);
      const stored = (posted['qa-666-declined'] || []).at(-1);
      assert.ok(stored, 'C: the chat was saved');
      assert.equal(stored.content, '', 'C: the note is not saved as the reply text');
      assert.deepEqual(stored.paused, { reason: 'declined', applied: 0, declined: ['project_append_file'] }, 'C: the note is saved as the pause record');
      assert.equal(stored.toolCalls[0].status, 'denied');

      await page.reload();
      await page.locator('[data-testid="reply-paused"]').first().waitFor({ timeout: 15000 });
      reply = lastReply();
      assert.equal((await reply.locator('[data-testid="reply-paused"]').innerText()).trim(), DECLINED_NOTE, 'C: the note survives a reload');
      assert.equal(await actions(reply).regenerate.count(), 1, 'C: Regenerate survives a reload');

      await box.fill(`What does ${FILE} say now?`);
      await page.keyboard.press('Enter');
      await page.getByText('Synthetic regenerated answer.').waitFor({ timeout: 10000 });
      sent = chatRequests.at(-1);
      assert.equal(JSON.stringify(sent.history).includes('No change was made'), false, 'C: the note is never sent to the model');
      const declinedEntry = sent.history.find((h) => h.role === 'tool' && h.declined === true);
      assert.ok(declinedEntry && declinedEntry.name === 'project_append_file' && declinedEntry.content === DECLINED, 'C: the next turn carries the declined result: ' + JSON.stringify(sent.history));
      console.log('PASS C: a declined write shows "No change was made: you declined project_append_file." under "1 declined", keeps Regenerate, is saved as a record (not text), survives a reload, and the next turn is told it did not run');
    });
    assert.deepEqual(errors, []);
  } catch (e) {
    failed = true;
    console.log('FAIL #666/#667 ' + String(e.message).split('\n').slice(0, 8).join('\n     '));
  } finally {
    await browser.close(); await fixture.close();
  }
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
