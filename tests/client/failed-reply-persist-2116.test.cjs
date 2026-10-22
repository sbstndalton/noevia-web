// #2116: a reply that failed was left out of the saved transcript, so after a page reload the question stood alone: no
// error and no Retry. A failed reply is now saved as a failed turn (the sentence the person was shown, any text that
// had streamed in, the record of changes it saved) and comes back as the same failed reply, with Retry on the last one.
// It is never replayed to the model. Synthetic transcripts only; the browser check is qa/failed-reply-reload-2116.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function load(names) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    const out = {};
    for (const n of names) out[n] = await server.ssrLoadModule(n);
    return out;
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

const FAILURE = 'The model took too long to answer, so the reply was ended. Try again.';
const user = { id: 'u1', role: 'user', content: 'Summarise the synthetic notes.' };
const failed = (extra = {}) => ({ id: 'a1', role: 'assistant', content: '', error: true, failure: FAILURE, ...extra });

test('#2116: a failed reply is saved as a failed turn and comes back as the same failed reply', async () => {
  const mods = await load(['/src/transcript-variants.ts']);
  const { entriesFor, messageFromEntry } = mods['/src/transcript-variants.ts'];
  const entries = entriesFor([user, failed()]);
  assert.equal(entries.length, 2, 'the failed reply is no longer left out');
  assert.equal(entries[1].role, 'assistant');
  assert.equal(entries[1].failure, FAILURE);
  assert.equal(entries[1].content, '');
  const back = messageFromEntry(JSON.parse(JSON.stringify(entries[1])), 'a-new');   // as the server stores and returns it
  assert.equal(back.error, true);
  assert.equal(back.failure, FAILURE);
  assert.equal(back.content, '');
});

test('#2116: text that had streamed in before the failure is kept with it, marked incomplete as before', async () => {
  const mods = await load(['/src/transcript-variants.ts']);
  const { entriesFor, messageFromEntry } = mods['/src/transcript-variants.ts'];
  const [, entry] = entriesFor([user, failed({ content: 'The notes say three things:' })]);
  assert.equal(entry.content, 'The notes say three things:');
  const back = messageFromEntry(entry, 'x');
  assert.deepEqual([back.error, back.failure, back.content], [true, FAILURE, 'The notes say three things:']);
});

test('#2116: an older error reply (the sentence is its content, no failure field) is saved with the sentence as its failure', async () => {
  const mods = await load(['/src/transcript-variants.ts']);
  const { entriesFor } = mods['/src/transcript-variants.ts'];
  const [, entry] = entriesFor([user, { id: 'a1', role: 'assistant', content: 'The model is not available.', error: true }]);
  assert.equal(entry.failure, 'The model is not available.');
  assert.equal(entry.content, '', 'never also saved as incomplete text');
});

test('#2116: a failed reply that had saved changes keeps their record (#658) and the failure', async () => {
  const mods = await load(['/src/transcript-variants.ts', '/src/applied-writes.ts']);
  const { entriesFor, messageFromEntry } = mods['/src/transcript-variants.ts'];
  const { rerunBase, modelHistory } = mods['/src/applied-writes.ts'];
  const write = { name: 'project_append_file', args: '{}', status: 'done', result: 'appended', applied: true, target: 'notes.md' };
  const [, entry] = entriesFor([user, failed({ toolCalls: [write] })]);
  assert.equal(entry.failure, FAILURE);
  assert.deepEqual(entry.paused, { reason: 'stopped', applied: 1 });
  assert.equal(entry.toolCalls.length, 1);
  const back = [user, messageFromEntry(entry, 'a2')];
  // Retry after the reload still tells the model the change is done, and never replays the failed reply's own text.
  assert.deepEqual(rerunBase(back, 1).map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual(modelHistory(back).map((e) => e.role), ['user', 'tool']);
});

test('#2116: the failed reply is never replayed to the model, before or after the reload', async () => {
  const mods = await load(['/src/transcript-variants.ts', '/src/applied-writes.ts']);
  const { entriesFor, messageFromEntry } = mods['/src/transcript-variants.ts'];
  const { modelHistory } = mods['/src/applied-writes.ts'];
  const live = [user, failed({ content: 'partial text' })];
  const reloaded = entriesFor(live).map((e, i) => messageFromEntry(e, `m${i}`));
  const next = { id: 'u2', role: 'user', content: 'Try again, shorter.' };
  assert.deepEqual(modelHistory([...live, next]), modelHistory([...reloaded, next]));
  assert.deepEqual(modelHistory([...reloaded, next]).map((e) => e.role), ['user', 'user']);
});

test('#2116: a failed Cowork start is not saved (its Retry must go to the harness, which a saved entry cannot say)', async () => {
  const mods = await load(['/src/transcript-variants.ts']);
  const { entriesFor } = mods['/src/transcript-variants.ts'];
  const entries = entriesFor([user, failed({ coworkRepository: 'synthetic/repo' })]);
  assert.deepEqual(entries.map((e) => e.role), ['user']);
});

test('#2116: only a well-formed failure on an assistant entry reads as a failed reply', async () => {
  const mods = await load(['/src/applied-writes.ts', '/src/transcript-variants.ts']);
  const { storedFailure, STORED_FAILURE_MAX } = mods['/src/applied-writes.ts'];
  const { messageFromEntry } = mods['/src/transcript-variants.ts'];
  assert.equal(storedFailure({ role: 'assistant', failure: FAILURE }), FAILURE);
  for (const failure of [undefined, null, '', '   ', 7, { text: 'x' }, ['x']]) assert.equal(storedFailure({ role: 'assistant', failure }), undefined, String(failure));
  assert.equal(storedFailure({ role: 'user', failure: FAILURE }), undefined, 'a user turn never counts as failed');
  assert.equal(storedFailure({ role: 'assistant', failure: 'x'.repeat(STORED_FAILURE_MAX + 50) }).length, STORED_FAILURE_MAX);
  assert.equal(messageFromEntry({ role: 'assistant', content: 'a fine answer', failure: 12 }, 'z').error, undefined);
  assert.equal(messageFromEntry({ role: 'user', content: 'hi', failure: FAILURE }, 'z').error, undefined);
});

test('#2116: a saved reply that answered is saved exactly as before (no failure field)', async () => {
  const mods = await load(['/src/transcript-variants.ts']);
  const { entriesFor } = mods['/src/transcript-variants.ts'];
  const [, entry] = entriesFor([user, { id: 'a1', role: 'assistant', content: 'Done.' }]);
  assert.equal(entry.failure, undefined);
  assert.equal(entry.content, 'Done.');
});

test('#2116: merging with another device keeps a real answer over a failed copy of the same turn', async () => {
  const mods = await load(['/src/transcript-merge.ts']);
  const { mergeTranscripts } = mods['/src/transcript-merge.ts'];
  const u = { role: 'user', content: 'Q' };
  const theirsFailed = [u, { role: 'assistant', content: '', failure: FAILURE }];
  const oursAnswered = [u, { role: 'assistant', content: 'A real answer.' }];
  assert.deepEqual(mergeTranscripts(theirsFailed, oursAnswered)[1].content, 'A real answer.');
  // Exactly one failed copy: the other is the answer, in both directions, even when the failed copy streamed more text.
  const longFailed = { role: 'assistant', content: 'A long partial text that streamed in before the failure, longer than the answer.', failure: FAILURE };
  const shortReal = { role: 'assistant', content: 'Short real answer.' };
  assert.equal(mergeTranscripts([u, longFailed], [u, shortReal])[1].content, 'Short real answer.');
  assert.equal(mergeTranscripts([u, shortReal], [u, longFailed])[1].content, 'Short real answer.');
  assert.equal(mergeTranscripts([u, longFailed], [u, { role: 'assistant', content: '', stopped: true }])[1].failure, undefined, 'a stopped reply is not a failure');
  // Two failed copies are two failures: the usual longer-copy rule.
  assert.equal(mergeTranscripts([u, { ...longFailed, content: 'x' }], [u, longFailed])[1].content, longFailed.content);
  // The server's copy of a reply it kept (interrupted) is not replaced by a failed copy made in this tab.
  const theirsKept = [u, { role: 'assistant', content: 'Half an answ', interrupted: true }];
  assert.equal(mergeTranscripts(theirsKept, [u, { role: 'assistant', content: '', failure: FAILURE }])[1].content, 'Half an answ');
});

test('#2116: the saved failed reply is on the page after a reload with Retry on the last reply (source contract)', () => {
  const fs = require('node:fs');
  const view = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');
  assert.match(view, /<FailedReply partial=\{m\.failure \? body : ''\} failure=\{m\.failure \?\? body\} canRetry=\{isLast\}/);
});
