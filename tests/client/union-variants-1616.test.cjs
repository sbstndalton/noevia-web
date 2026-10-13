// #1616: Edit & re-run with unchanged text makes two versions of one turn with the same text and different chats.
// Merging two copies of the turn must keep both, must still fold a version that only went on chatting into one, and
// the version shown must be found by its chat, not by the first version with the same text. Synthetic data only.
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
const fromEntry = (h, id) => ({ id, ...h });
const turn = (role, content) => ({ role, content });
const T0 = [turn('assistant', 'First reply')];
const T1 = [turn('assistant', 'Second reply')];
const version = (content, tail) => ({ content, tail });

test('#1616: two versions with the same text and different chats both survive a merge', async () => {
  const [save, merge] = await load();
  const theirs = [{ role: 'user', content: 'X', branches: [version('X', T0)], branch: 0 }, turn('assistant', 'First reply')];
  const ours = [{ role: 'user', content: 'X', branches: [version('X', T0), version('X', T1)], branch: 1 }, turn('assistant', 'Second reply')];
  for (const [a, b] of [[theirs, ours], [ours, theirs]]) {
    const merged = merge.mergeTranscripts(a, b);
    const user = merged.find((e) => e.role === 'user');
    assert.deepEqual(user.branches.map((v) => v.tail[0].content).sort(), ['First reply', 'Second reply']);
  }
  // The shown transcript takes the same union.
  const current = [{ id: 'u1', role: 'user', content: 'X', branches: [version('X', T0), version('X', T1)], branch: 1 }, { id: 'r1', role: 'assistant', content: 'Second reply' }];
  const shown = save.adoptMergedTranscript(current, merge.mergeTranscripts(theirs, ours), () => 'new', fromEntry);
  assert.deepEqual(shown[0].branches.map((v) => v.tail[0].content), ['First reply', 'Second reply']);
  // And from the other side: this tab only has the first version, the saved copy has both.
  const mineOnly = [{ id: 'u1', role: 'user', content: 'X', branches: [version('X', T0)], branch: 0 }, { id: 'r1', role: 'assistant', content: 'First reply' }];
  const entry = { role: 'user', content: 'X', branches: [version('X', T0), version('X', T1)], branch: 1 };
  const adopted = save.adoptMergedTranscript(mineOnly, [entry, turn('assistant', 'First reply')], () => 'new', fromEntry);
  assert.deepEqual(adopted[0].branches.map((v) => v.tail[0].content), ['First reply', 'Second reply']);
});

test('#1616: a version that only gained later turns in the other tab merges into one, keeping the longer chat', async () => {
  const [save, merge] = await load();
  const longer = [...T0, turn('user', 'And then?'), turn('assistant', 'Then this.')];
  const theirs = [{ role: 'user', content: 'X', branches: [version('X', longer)], branch: 0 }, turn('assistant', 'First reply')];
  const ours = [{ role: 'user', content: 'X', branches: [version('X', T0)], branch: 0 }, turn('assistant', 'First reply')];
  for (const [a, b] of [[theirs, ours], [ours, theirs]]) {
    const user = merge.mergeTranscripts(a, b).find((e) => e.role === 'user');
    assert.equal(user.branches.length, 1);
    assert.equal(user.branches[0].tail.length, 3);
  }
  const current = [{ id: 'u1', role: 'user', content: 'X', branches: [version('X', T0), version('Y', T1)], branch: 0 }, { id: 'r1', role: 'assistant', content: 'First reply' }];
  const entry = { role: 'user', content: 'X', branches: [version('X', longer)], branch: 0 };
  const shown = save.adoptMergedTranscript(current, [entry, turn('assistant', 'First reply')], () => 'new', fromEntry);
  assert.deepEqual(shown[0].branches.map((v) => [v.content, v.tail.length]), [['X', 3], ['Y', 1]]);
  assert.equal(shown[0].branch, 0);
});

test('#1616: after the merge the chosen index points at the version on screen, not the first with the same text', async () => {
  const [save] = await load();
  // The saved copy holds both X versions; this tab shows the second one and also made a version Y.
  const current = [
    { id: 'u1', role: 'user', content: 'X', branches: [version('X', T0), version('X', T1), version('Y', [turn('assistant', 'Y reply')])], branch: 1 },
    { id: 'r1', role: 'assistant', content: 'Second reply' },
  ];
  const entry = { role: 'user', content: 'X', branches: [version('X', T0), version('X', T1)], branch: 0 };
  const shown = save.adoptMergedTranscript(current, [entry, turn('assistant', 'Second reply')], () => 'new', fromEntry);
  assert.equal(shown[0].branches.length, 3);
  assert.equal(shown[0].branch, 1);
  assert.equal(shown[0].branches[shown[0].branch].tail[0].content, 'Second reply');
  // Over the limit of 10 the shown version is still kept and the pointer follows it (#1517).
  const many = Array.from({ length: 12 }, (_, i) => version('Z' + i, [turn('assistant', 'z' + i)]));
  const crowded = [{ id: 'u1', role: 'user', content: 'X', branches: [version('X', T0), version('X', T1), ...many], branch: 1 }, { id: 'r1', role: 'assistant', content: 'Second reply' }];
  const wider = { ...entry, branches: [...entry.branches, version('W', [turn('assistant', 'w')])] };
  const capped = save.adoptMergedTranscript(crowded, [wider, turn('assistant', 'Second reply')], () => 'new', fromEntry);
  assert.equal(capped[0].branches.length, 10);
  assert.equal(capped[0].branches[capped[0].branch].tail[0].content, 'Second reply');
  assert.equal(capped[0].branches[capped[0].branch].content, 'X');
});

test('#1616: answers still dedupe by their text while same-text versions of the same turn are kept apart', async () => {
  const [save, merge] = await load();
  const both = merge.unionVariants([{ content: 'A', tail: T0 }], [{ content: 'A', tail: T1 }]);
  assert.equal(both.length, 1, 'answers (no versions flag) are told apart by text alone');
  const mixed = merge.mergeTranscripts(
    [{ role: 'user', content: 'Q', answers: [{ content: 'A' }], answer: 0, branches: [version('Q', T0), version('Q', T1)], branch: 1 }, turn('assistant', 'A')],
    [{ role: 'user', content: 'Q', answers: [{ content: 'A' }], answer: 0, branches: [version('Q', T0)], branch: 0 }, turn('assistant', 'A')],
  ).find((e) => e.role === 'user');
  assert.equal(mixed.answers.length, 1);
  assert.equal(mixed.branches.length, 2);
  const ours = [{ role: 'user', content: 'Q', answers: [{ content: 'A' }, { content: 'B' }], answer: 1 }, turn('assistant', 'B')];
  const theirs = [{ role: 'user', content: 'Q', answers: [{ content: 'A', stats: undefined }, { content: 'C' }], answer: 0 }, turn('assistant', 'A')];
  const user = merge.mergeTranscripts(theirs, ours).find((e) => e.role === 'user');
  assert.deepEqual(user.answers.map((a) => a.content).sort(), ['A', 'B', 'C']);
  const current = [{ id: 'u1', role: 'user', content: 'Q', answers: [{ content: 'A' }, { content: 'B' }], answer: 1 }, { id: 'r1', role: 'assistant', content: 'B' }];
  const shown = save.adoptMergedTranscript(current, [{ role: 'user', content: 'Q', answers: [{ content: 'A' }, { content: 'B' }, { content: 'A' }, { content: 'C' }], answer: 1 }, turn('assistant', 'B')], () => 'new', fromEntry);
  assert.deepEqual(shown[0].answers.map((a) => a.content), ['A', 'B', 'A', 'C']);
});
