// #1517: Regenerate and Edit & re-run keep the earlier answer or version, shown with a 1/2 ‹ › switcher, and
// the model is sent only the active path. Synthetic transcripts only. Covers the two flows end to end through
// the pure module: the saved form and back (so a reload keeps every alternative), the switch, the model
// context, and the App and ChatView wiring by source contract (the click path is a browser check, unverified).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

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

let counter = 0;
const id = () => `m${++counter}`;
const user = (text, extra = {}) => ({ id: id(), role: 'user', content: text, ...extra });
const reply = (text, extra = {}) => ({ id: id(), role: 'assistant', content: text, ...extra });

/** Reloads a transcript from its saved form, as the app does on the next visit. */
function reloaded(tv, messages) {
  return tv.entriesFor(messages).map((h) => tv.messageFromEntry(h, id()));
}

test('regenerate keeps the answer it replaces, and the new one is a second answer on the same question', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const q = user('Plant tomatoes when?');
  const first = reply('In spring.');
  const before = [q, first];
  // Regenerate: the turn keeps the first answer and the new reply lands after it.
  const regenerated = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, first) };
  assert.equal(regenerated.answer, 1);
  assert.deepEqual(regenerated.answers.map((a) => a.content), ['In spring.']);
  const second = reply('After the last frost.');
  const list = [regenerated, second];
  assert.equal(tv.answerCount(regenerated), 2, 'two answers, so the switcher shows 2/2');
  // Saved and reloaded: both answers survive, and the one shown is still the second.
  const saved = reloaded(tv, list);
  assert.deepEqual(saved[0].answers.map((a) => a.content), ['In spring.', 'After the last frost.']);
  assert.equal(saved[0].answer, 1);
  assert.equal(saved[1].content, 'After the last frost.');
  assert.equal(before.length, 2, 'the earlier list is untouched');
}));

test('switching to an earlier answer shows it on the reply, keeps the other, and is saved the same way', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const q = user('Plant tomatoes when?');
  const regenerated = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, reply('In spring.')) };
  const list = [regenerated, reply('After the last frost.')];
  const back = tv.selectAnswer(list, 0, 0);
  assert.ok(back, 'a different answer can be shown');
  assert.equal(back[1].content, 'In spring.');
  assert.equal(back[0].answer, 0);
  assert.equal(tv.selectAnswer(back, 0, 0), null, 'the answer already shown changes nothing');
  assert.equal(tv.selectAnswer(back, 0, 5), null, 'an answer that does not exist changes nothing');
  // The answer that was shown is not lost when the other is picked.
  const forward = tv.selectAnswer(back, 0, 1);
  assert.equal(forward[1].content, 'After the last frost.');
  const again = reloaded(tv, back);
  assert.equal(again[1].content, 'In spring.');
  assert.deepEqual(again[0].answers.map((a) => a.content), ['In spring.', 'After the last frost.']);
}));

test('an answer shown after a switch carries none of the previous answer’s fields', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const q = user('Q');
  const old = reply('Old', { reasoning: 'thought', stats: { tokens: 3 }, senderLabel: 'Model A' });
  const regenerated = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, old) };
  const list = [regenerated, reply('New', { senderLabel: 'Model B' })];
  const back = tv.selectAnswer(list, 0, 0);
  assert.equal(back[1].content, 'Old');
  assert.equal(back[1].reasoning, 'thought');
  assert.equal(back[1].senderLabel, 'Model A');
  const forward = tv.selectAnswer(back, 0, 1);
  assert.equal(forward[1].senderLabel, 'Model B');
  assert.equal(forward[1].reasoning, undefined, 'the thinking of the other answer does not follow');
}));

test('the model is sent only the answer on screen, never the stored alternatives', () => load(['/src/transcript-variants.ts', '/src/applied-writes.ts']).then(({ '/src/transcript-variants.ts': tv, '/src/applied-writes.ts': aw }) => {
  const q = user('Q');
  const regenerated = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, reply('Stored, not shown')) };
  const list = [regenerated, reply('Shown answer')];
  const context = aw.modelHistory(list).map((e) => e.content);
  assert.deepEqual(context, ['Q', 'Shown answer']);
  const switched = aw.modelHistory(tv.selectAnswer(list, 0, 0)).map((e) => e.content);
  assert.deepEqual(switched, ['Q', 'Stored, not shown'], 'after a switch the context follows the answer now shown');
}));

test('edit & re-run keeps the earlier version of the turn with the chat that followed it', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const original = user('Water daily?');
  const oldAnswer = reply('Yes, every day.');
  const oldTail = [oldAnswer];
  const edited = { ...user('Water weekly?'), id: id(), ...tv.branchesBeforeEdit(original, oldTail) };
  assert.equal(edited.branch, 1);
  assert.equal(edited.branches[0].content, 'Water daily?');
  const newAnswer = reply('Once a week is enough.');
  const list = [edited, newAnswer];
  assert.equal(tv.branchCount(edited), 2, 'two versions, so the switcher shows 2/2');
  const saved = reloaded(tv, list);
  assert.equal(saved[0].branches[0].content, 'Water daily?');
  assert.equal(saved[0].branches[0].tail[0].content, 'Yes, every day.');
  assert.equal(saved[0].branches[1].tail[0].content, 'Once a week is enough.');
}));

test('switching to an earlier version restores its text and its chat, and the other is kept', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const original = user('Water daily?');
  const edited = { ...user('Water weekly?'), id: id(), ...tv.branchesBeforeEdit(original, [reply('Yes, every day.')]) };
  const list = [edited, reply('Once a week is enough.')];
  const ids = [];
  const next = () => { const v = `r${ids.length + 1}`; ids.push(v); return v; };
  const back = tv.selectBranch(list, 0, 0, next);
  assert.ok(back);
  assert.equal(back[0].content, 'Water daily?');
  assert.equal(back[0].branch, 0);
  assert.equal(back[1].content, 'Yes, every day.');
  assert.equal(back[1].id, 'r1', 'the revived reply gets a fresh id');
  assert.equal(back.length, 2);
  assert.equal(tv.selectBranch(back, 0, 0, next), null);
  const forward = tv.selectBranch(back, 0, 1, next);
  assert.equal(forward[0].content, 'Water weekly?');
  assert.equal(forward[1].content, 'Once a week is enough.');
  const again = reloaded(tv, back);
  assert.equal(again[0].branch, 0);
  assert.equal(again[0].branches[1].content, 'Water weekly?');
}));

test('answers kept on a turn come back with the version that had them', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const original = user('Q');
  const regenerated = { ...original, id: id(), ...tv.answersBeforeRegenerate(original, reply('A1')) };
  const withTwo = [regenerated, reply('A2')];
  const edited = { ...user('Q2'), id: id(), ...tv.branchesBeforeEdit(regenerated, [reply('A2')]) };
  const list = [edited, reply('A3')];
  const back = tv.selectBranch(list, 0, 0, () => 'x');
  assert.equal(back[0].content, 'Q');
  assert.deepEqual(back[0].answers.map((a) => a.content), ['A1', 'A2'], 'the answers of the earlier version are restored');
  assert.equal(back[0].answer, 1);
  assert.equal(withTwo.length, 2);
}));

test('a failed reply is not stored as an answer, and a turn with no alternatives is left alone', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const q = user('Q');
  const failed = reply('partial', { error: true });
  const kept = tv.entriesFor([q, failed]);
  assert.equal(kept.length, 1, 'the failed reply is not saved');
  assert.equal(tv.answerCount(q), 1);
  assert.equal(tv.branchCount(q), 1);
  assert.equal(tv.selectAnswer([q, reply('A')], 0, 1), null, 'nothing stored means nothing to switch to');
  assert.equal(tv.selectBranch([q], 0, 1, () => 'x'), null);
}));

test('a regenerate that never finished shows the last saved answer after a reload, and its switcher agrees', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const q = user('Q');
  // The new answer failed, so the saved turn has the old answer and no reply after it.
  const regenerated = { ...q, id: id(), ...tv.answersBeforeRegenerate(q, reply('Old answer')) };
  const loaded = reloaded(tv, [regenerated]);
  assert.equal(loaded.length, 1, 'nothing is stored for the failed reply');
  const shown = tv.withStoredAnswers(loaded, () => 'shown');
  assert.equal(shown.length, 2);
  assert.equal(shown[1].content, 'Old answer');
  assert.equal(shown[1].id, 'shown');
  assert.equal(tv.answerCount(shown[0]), 1, 'one answer, so no switcher');
  // A turn whose answer is already there is left alone.
  const intact = [regenerated, reply('New')];
  assert.deepEqual(tv.withStoredAnswers(intact, () => 'x'), intact);
}));

test('the saved form keeps the Regenerate and Edit fields and is read back as messages', () => load(['/src/transcript-variants.ts']).then(({ '/src/transcript-variants.ts': tv }) => {
  const q = { ...user('Q'), id: id(), ...tv.answersBeforeRegenerate(user('Q'), reply('old')) };
  const [entry] = tv.entriesFor([q, reply('new')]);
  assert.ok(Array.isArray(entry.answers));
  assert.equal(entry.answer, 1);
  const message = tv.messageFromEntry(entry, 'loaded');
  assert.equal(message.id, 'loaded');
  assert.equal(message.answers.length, 2);
  assert.equal(message.answer, 1);
}));

test('the flows are wired into App by source contract: Regenerate and Edit pass their source, and the switcher saves', () => {
  const app = read('App.tsx');
  assert.match(app, /variantOf: \{ kind: 'answer', user: msgs\[msgs\.length - 2\], reply: msgs\[msgs\.length - 1\] \}/);
  assert.match(app, /\{ variantOf: \{ kind: 'branch', user: msgs\[index\], tail: msgs\.slice\(index \+ 1\) \} \}/);
  assert.match(app, /const variantFields = turn\.variantOf\?\.kind === 'answer'/);
  assert.match(app, /const showVariant = useCallback\(/);
  assert.match(app, /if \(!deletedChats\.current\.has\(chatId\)\) persist\(chatId, updated\);/);
  assert.match(app, /onChooseAnswer=\{chooseAnswer\}/);
  assert.match(app, /onChooseVersion=\{chooseVersion\}/);
});

test('the switcher is drawn on the reply and the edited turn, and is disabled while anything streams', () => {
  const view = read('components/ChatView.tsx');
  assert.match(view, /<VariantSwitch index=\{\(answerUser\.answer \?\? 0\) \+ 1\} count=\{answers\} disabled=\{streaming \|\| actionBusy\}/);
  assert.match(view, /<VariantSwitch index=\{\(m\.branch \?\? 0\) \+ 1\} count=\{versions\} disabled=\{streaming \|\| actionBusy\}/);
  assert.match(view, /onChooseAnswer\?\.\(chatId, answerUser\.id, \(answerUser\.answer \?\? 0\) - 1\)/);
  assert.match(view, /onChooseVersion\?\.\(chatId, m\.id, \(m\.branch \?\? 0\) - 1\)/);
  assert.match(view, /<span aria-live="polite">\{index\}\/\{count\}<\/span>/);
});

test('every core catalogue carries the six switcher strings', () => {
  for (const file of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const src = read(`i18n/${file}.ts`);
    for (const key of ['chat.variant.answers', 'chat.variant.versions', 'chat.variant.previousAnswer', 'chat.variant.nextAnswer', 'chat.variant.previousVersion', 'chat.variant.nextVersion']) {
      assert.match(src, new RegExp(`'${key.replace(/\./g, '\\.')}'`), `${file} ${key}`);
    }
  }
});
