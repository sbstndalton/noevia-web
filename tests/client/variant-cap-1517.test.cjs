// #1517 owner decision (2026-10-13): a message keeps its last 10 variants; older ones drop off and the
// chosen one is never dropped. The server enforces it on save (noevia-core chat-variants.cjs); the client
// applies the same rule where Regenerate and Edit & re-run add a variant, and where two tabs' copies merge,
// so what is on screen matches what is stored. Exports have no client side: the server builds them and
// carries only the chosen reply (noevia-core chat-variants-1517.test.cjs). Synthetic transcripts only.
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
const mods = ['/src/variant-cap.ts', '/src/transcript-variants.ts', '/src/chat-save.ts'];
let n = 0;
const id = () => `m${++n}`;
const answers = (count) => Array.from({ length: count }, (_, i) => ({ content: `answer ${i}` }));

test('an 11th variant drops the oldest: regenerating over ten stored answers keeps the newest ten', async () => {
  const { '/src/transcript-variants.ts': tv } = await load(mods);
  // Ten answers exist; the tenth is on screen. Regenerate keeps nine of them and the new reply takes slot ten.
  const q = { id: id(), role: 'user', content: 'Q', answers: answers(10), answer: 9 };
  const shown = { id: id(), role: 'assistant', content: 'answer 9' };
  const next = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, shown) };
  assert.equal(next.answers.length, 9);
  assert.equal(next.answer, 9, 'the slot for the new reply is the tenth');
  assert.equal(next.answers[0].content, 'answer 1', 'answer 0, the oldest, dropped');
  assert.equal(next.answers[8].content, 'answer 9', 'the answer that was shown is kept as a variant');
  // The new reply lands: ten in all, and the saved form carries exactly those.
  const saved = tv.entriesFor([next, { id: id(), role: 'assistant', content: 'answer 10' }]);
  assert.equal(saved[0].answers.length, 10);
  assert.equal(saved[0].answers[saved[0].answer].content, 'answer 10');
  assert.equal(tv.answerCount(next), 10, 'the switcher says 10, not 11');
});

test('repeated regenerates never keep more than ten answers', async () => {
  const { '/src/transcript-variants.ts': tv } = await load(mods);
  let q = { id: id(), role: 'user', content: 'Q' };
  let reply = { id: id(), role: 'assistant', content: 'reply 0' };
  for (let i = 1; i <= 25; i++) {
    q = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, reply) };
    reply = { id: id(), role: 'assistant', content: `reply ${i}` };
    assert.ok(tv.answerCount(q) <= 10, `after regenerate ${i}: ${tv.answerCount(q)} answers`);
  }
  const [saved] = tv.entriesFor([q, reply]);
  assert.deepEqual(saved.answers.map((a) => a.content), Array.from({ length: 10 }, (_, i) => `reply ${i + 16}`));
  assert.equal(saved.answers[saved.answer].content, 'reply 25');
});

test('Edit & re-run keeps the newest ten versions too', async () => {
  const { '/src/transcript-variants.ts': tv } = await load(mods);
  let q = { id: id(), role: 'user', content: 'version 0' };
  let tail = [{ id: id(), role: 'assistant', content: 'reply to 0' }];
  for (let i = 1; i <= 12; i++) {
    q = { ...q, id: id(), content: q.content, ...tv.branchesBeforeEdit(q, tail) };
    q = { ...q, content: `version ${i}` };
    tail = [{ id: id(), role: 'assistant', content: `reply to ${i}` }];
    assert.ok(tv.branchCount(q) <= 10, `after edit ${i}: ${tv.branchCount(q)} versions`);
  }
  const [saved] = tv.entriesFor([q, ...tail]);
  assert.equal(saved.branches.length, 10);
  assert.equal(saved.branches[saved.branch].content, 'version 12');
  assert.equal(saved.branches[0].content, 'version 3');
});

test('the chosen variant survives even when it is the oldest', async () => {
  const { '/src/variant-cap.ts': cap } = await load(mods);
  const { list, chosen } = cap.capVariants(answers(11), 0);
  assert.equal(list.length, 10);
  assert.equal(chosen, 0);
  assert.equal(list[0].content, 'answer 0');
  assert.equal(list[1].content, 'answer 2', 'the oldest of the others dropped instead');
  const middle = cap.capVariants(answers(14), 5);
  assert.equal(middle.list.length, 10);
  assert.equal(middle.list[middle.chosen].content, 'answer 5');
  assert.equal(cap.capVariants(answers(10), 3).list.length, 10, 'ten fit');
});

test('merging two tabs past ten answers drops the oldest others and keeps the one on screen', async () => {
  const { '/src/chat-save.ts': save, '/src/transcript-variants.ts': tv } = await load(mods);
  const ours = [{ id: 'u1', role: 'user', content: 'Q', answers: answers(8), answer: 0 }, { id: 'r1', role: 'assistant', content: 'answer 0' }];
  // The other tab regenerated: it holds ten answers, none of ours but "answer 0".
  const theirs = Array.from({ length: 10 }, (_, i) => ({ content: i === 0 ? 'answer 0' : `other ${i}` }));
  const merged = [{ role: 'user', content: 'Q', answers: theirs, answer: 9 }, { role: 'assistant', content: 'other 9' }];
  const shown = save.adoptMergedTranscript([{ ...ours[0] }, { ...ours[1] }], merged, () => 'new', (h, mint) => ({ id: mint, ...h }));
  assert.ok(tv.answerCount(shown[0]) <= 10, `${tv.answerCount(shown[0])} answers after the merge`);
  assert.equal(shown[0].answers[shown[0].answer].content, 'other 9', 'the pointer names the answer shown');
});
