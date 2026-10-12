// #658 x #1517: Regenerate and Edit & re-run keep the record of changes a replaced reply saved (so the model is told
// they are done), and keep the replaced answer or version for the switcher. The two must not interfere:
// - a Regenerate must not save the empty record over a stored answer, nor leave the old turn carrying the answers
// - switching back to a stored answer or version must not tell the model about the same write twice.
// Synthetic transcripts only.
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
const mods = () => load(['/src/transcript-variants.ts', '/src/applied-writes.ts', '/src/regenerate.ts']);

let n = 0;
const id = () => `m${++n}`;
const user = (text, extra = {}) => ({ id: id(), role: 'user', content: text, ...extra });
const reply = (text, extra = {}) => ({ id: id(), role: 'assistant', content: text, ...extra });
// A finished call keeps no approval id, so a write is told apart by its tool, target, arguments and result.
const write = (file) => ({ name: 'project_create_file', args: `{"name":"${file}"}`, status: 'done', applied: true, target: file, result: `Created ${file}` });
const appliedEntries = (history) => history.filter((e) => e.role === 'tool' && e.applied);

/** What handleSend builds for a Regenerate: the plan's base plus a new user turn that takes the answers over. */
function regenerate(tv, regen, list, newReplyText, extra = {}) {
  const plan = regen.planRegenerate(list, list[list.length - 1].id);
  assert.ok(plan, 'the last reply can be regenerated');
  const prompt = list[list.length - 2];
  const next = { ...prompt, id: id(), ...tv.answersBeforeRegenerate(prompt, list[list.length - 1]) };
  return [...plan.base, next, reply(newReplyText, extra)];
}

test('#1517 Regenerate after a reply that saved changes: the kept old turn gives up its answers, so the record cannot overwrite one', () => mods().then(({ '/src/transcript-variants.ts': tv, '/src/regenerate.ts': regen }) => {
  const q = user('Create the notes file');
  const first = reply('Created it.', { toolCalls: [write('a.md')] });
  const once = regenerate(tv, regen, [q, first], 'Done, again.', { toolCalls: [write('b.md')] });
  // [old turn, record of a.md, turn carrying the answers, new reply]
  assert.equal(once.length, 4);
  assert.equal(once[0].answers, undefined);
  assert.deepEqual(once[2].answers.map((a) => a.content), ['Created it.']);
  const twice = regenerate(tv, regen, once, 'A third try.');
  // The turn that carried the answers is now the kept one; it no longer carries them.
  const kept = twice.filter((m) => m.role === 'user');
  assert.equal(kept.filter((m) => m.answers !== undefined).length, 1, 'the stored answers live on exactly one turn');
  assert.deepEqual(twice.at(-2).answers.map((a) => a.content), ['Created it.', 'Done, again.'], 'the new turn takes the answers over');
  // Saved and reloaded: the answers are intact and the record is not stored as one of them.
  const saved = tv.entriesFor(twice);
  const holder = saved.find((e) => e.answers);
  assert.deepEqual(holder.answers.map((a) => a.content), ['Created it.', 'Done, again.', 'A third try.'], 'every answer, the one shown included');
  assert.ok(holder.answers.every((a) => a.content.trim()), 'no empty record among the answers');
  assert.equal(saved.filter((e) => e.answers).length, 1, 'one switcher after a reload');
}));

test('#658 a record (no text) never replaces a stored answer that has text, but fills an empty slot', () => mods().then(({ '/src/transcript-variants.ts': tv }) => {
  const q = user('Q', { answers: [{ content: 'A full answer' }], answer: 0 });
  const record = { id: id(), role: 'assistant', content: '', toolCalls: [write('a.md')], paused: { reason: 'stopped', applied: 1 } };
  assert.deepEqual(tv.syncedAnswers(q, record).map((a) => a.content), ['A full answer']);
  const fresh = user('Q', { answers: [{ content: 'A full answer' }], answer: 1 });
  assert.equal(tv.syncedAnswers(fresh, record).length, 2, 'a slot with nothing in it takes the record');
}));

test('#658 switching back to an answer or version whose writes a kept record already tells does not tell the model twice', () => mods().then(({ '/src/transcript-variants.ts': tv, '/src/applied-writes.ts': aw }) => {
  // Regenerate: answer 0 saved a.md; the record of it stays before the turn that carries the answers.
  const q = user('Create the notes file');
  const first = reply('Created it.', { toolCalls: [write('a.md')] });
  const record = aw.appliedRecord(first);
  const carrier = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, first) };
  const list = [record, carrier, reply('Second answer, no writes.')];
  assert.equal(appliedEntries(aw.modelHistory(list)).length, 1, 'the record tells it once');
  const back = tv.selectAnswer(list, 1, 0);
  assert.ok(back);
  assert.equal(back[2].toolCalls[0].target, 'a.md', 'the stored answer is shown again with its write');
  assert.equal(appliedEntries(aw.modelHistory(back)).length, 1, 'the record and the shown answer name the same write once');
  // Edit & re-run: the dropped reply saved b.md; its record stays, and the branch comes back with that reply.
  const turn = user('Make file b');
  const tail = [reply('Made it.', { toolCalls: [write('b.md')] })];
  const kept = aw.editBase([turn, ...tail], 0);
  const edited = { ...turn, id: id(), content: 'Make file c', ...tv.branchesBeforeEdit(turn, tail) };
  const afterEdit = [...kept, edited, reply('Made c.')];
  const restored = tv.selectBranch(afterEdit, kept.length, 0, id);
  assert.ok(restored);
  assert.equal(appliedEntries(aw.modelHistory(restored)).length, 1, 'b.md is told once, not by the record and by the restored reply');
  // A genuinely different write is still told.
  const other = [...restored, reply('Another', { toolCalls: [write('c.md')] })];
  assert.equal(appliedEntries(aw.modelHistory(other)).length, 2);
}));
