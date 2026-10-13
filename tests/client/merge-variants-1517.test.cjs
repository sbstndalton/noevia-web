// #1517: another tab's Regenerate or Edit & re-run must not lose an answer or a version when the two copies are
// merged after a concurrent save. The merge of the entries unions the stored answers/versions of the shared turns,
// and the transcript shown keeps the local messages (their ids) but takes the union. Synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function load() {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    return [await server.ssrLoadModule('/src/chat-save.ts'), await server.ssrLoadModule('/src/transcript-merge.ts')];
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}
const answers = (...texts) => texts.map((content) => ({ content }));
const fromEntry = (h, id) => ({ id, ...h });

test('a Regenerate in another tab keeps its answer: the merged entries and the shown messages both carry every answer', async () => {
  const [save, merge] = await load();
  // This tab: one answer. The other tab regenerated: two answers, the second shown.
  const ours = [{ role: 'user', content: 'Q', answers: answers('First'), answer: 0 }, { role: 'assistant', content: 'First' }];
  const theirs = [{ role: 'user', content: 'Q', answers: answers('First', 'Second'), answer: 1 }, { role: 'assistant', content: 'Second' }];
  const merged = merge.mergeTranscripts(theirs, ours);
  assert.deepEqual(merged[0].answers.map((a) => a.content), ['First', 'Second']);
  // The reverse (this tab regenerated, the other did not) keeps ours.
  const reverse = merge.mergeTranscripts(ours, theirs);
  assert.deepEqual(reverse[0].answers.map((a) => a.content), ['First', 'Second']);
  // Shown: the local user turn keeps its id and takes the other tab's answers; the pointer follows the reply shown.
  const current = [{ id: 'u1', role: 'user', content: 'Q', answers: answers('First'), answer: 0 }, { id: 'r1', role: 'assistant', content: 'First' }];
  const shown = save.adoptMergedTranscript(current, merged, () => 'new', fromEntry);
  assert.equal(shown[0].id, 'u1');
  assert.deepEqual(shown[0].answers.map((a) => a.content), ['First', 'Second']);
  const reply = shown[1];
  assert.equal(shown[0].answers[shown[0].answer].content, reply.content, 'the pointer names the answer that is on screen');
});

test('answers only the local copy has are kept too', async () => {
  const [save, merge] = await load();
  const ours = [{ role: 'user', content: 'Q', answers: answers('A', 'B'), answer: 1 }, { role: 'assistant', content: 'B' }];
  const theirs = [{ role: 'user', content: 'Q', answers: answers('A', 'C'), answer: 1 }, { role: 'assistant', content: 'C' }, { role: 'user', content: 'More' }];
  const merged = merge.mergeTranscripts(theirs, ours);
  assert.deepEqual(merged[0].answers.map((a) => a.content).sort(), ['A', 'B', 'C']);
  const current = [{ id: 'u1', role: 'user', content: 'Q', answers: answers('A', 'B'), answer: 1 }, { id: 'r1', role: 'assistant', content: 'B' }];
  const shown = save.adoptMergedTranscript(current, merged, () => 'new', fromEntry);
  assert.deepEqual(shown[0].answers.map((a) => a.content).sort(), ['A', 'B', 'C']);
});

test('versions from both tabs are kept for a turn both have', async () => {
  const [save, merge] = await load();
  const branch = (content) => ({ content, tail: [] });
  const ours = [{ role: 'user', content: 'v2', branches: [branch('v1'), branch('v2')], branch: 1 }];
  const theirs = [{ role: 'user', content: 'v2', branches: [branch('v1'), branch('v2'), branch('v3')], branch: 1 }, { role: 'assistant', content: 'ok' }];
  const merged = merge.mergeTranscripts(theirs, ours);
  assert.deepEqual(merged[0].branches.map((b) => b.content), ['v1', 'v2', 'v3']);
  const current = [{ id: 'u1', role: 'user', content: 'v2', branches: [branch('v1'), branch('v2')], branch: 1 }];
  const shown = save.adoptMergedTranscript(current, merged, () => 'new', fromEntry);
  assert.equal(shown[0].branches.length, 3);
  assert.equal(shown[0].branches[shown[0].branch].content, 'v2', 'the version on screen is still the one shown');
});

test('copies with the same alternatives, or none, merge exactly as before', async () => {
  const [save, merge] = await load();
  const entries = [{ role: 'user', content: 'Q', answers: answers('A'), answer: 0 }, { role: 'assistant', content: 'A' }];
  assert.equal(merge.mergeTranscripts(entries, entries.map((e) => ({ ...e }))).length, 2);
  const plain = [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }];
  assert.equal(merge.mergeTranscripts(plain, plain), plain, 'nothing to share: the winning copy is returned as it was');
  const current = [{ id: 'u1', role: 'user', content: 'Q', answers: answers('A'), answer: 0, files: ['x.txt'] }, { id: 'r1', role: 'assistant', content: 'A' }];
  const shown = save.adoptMergedTranscript(current, entries, () => 'new', fromEntry);
  assert.equal(shown[0], current[0], 'an unchanged local turn is the same message, keeping its local-only fields');
});
