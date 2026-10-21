'use strict';
// #96: a recovered (reloaded) failed Diary row carries the same `code` and `reason` the live stream error
// carried (core#231). recoverDiaryTurns words it through the same diary-errors.ts mapping as the live error, so
// a reloaded chat_timeout or length_cap row shows the same sentence as live. A row without them keeps today's text.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, Intl, Number, Object, Error, String, Set, require: (m) => load(path.posix.join(path.posix.dirname(file), m).replace(/^\.\//, '')) });
  return exports_;
}
const { diaryErrorText, diaryStreamFailure } = load('diary-errors');
const { recoverDiaryTurns } = load('diary-server-recovery');
const t = (key, p = {}) => `${key}|${JSON.stringify(p)}`;
// What DiaryView passes: the live mapping, in the interface language.
const wording = (failure) => diaryErrorText(t, failure, 'en-GB');
const SERVER_TEXT = "Couldn't reach the local model — nothing was saved. You can resend.";
const row = (over = {}) => ({ id: 'ex1', message: 'Synthetic line', content: '', reasoning: '', startedAt: 5, activity: ['Generating companion response…'], state: 'failed', error: SERVER_TEXT, ...over });
const notice = (turns) => turns[1].activity.at(-1);
const live = (event) => diaryErrorText(t, diaryStreamFailure({ type: 'error', text: SERVER_TEXT, saved: false, ...event }, 'unused'), 'en-GB');

test('a recovered chat_timeout row shows the same sentence as the live error', () => {
  const turns = recoverDiaryTurns([row({ code: 'modelFailed', reason: 'chat_timeout' })], wording);
  assert.equal(notice(turns), 'diary.errors.modelTimedOut|{}');
  assert.equal(notice(turns), live({ code: 'modelFailed', reason: 'chat_timeout' }));
  assert.equal(turns[0].failed, true); assert.equal(turns[1].failed, true); assert.equal(turns[0].exchangeId, 'ex1');
});
test('a recovered length_cap row shows the same sentence as the live error', () => {
  const turns = recoverDiaryTurns([row({ code: 'modelFailed', reason: 'length_cap' })], wording);
  assert.equal(notice(turns), 'diary.errors.modelLengthCap|{}');
  assert.equal(notice(turns), live({ code: 'modelFailed', reason: 'length_cap' }));
});
test('an old row without code and reason keeps today’s text, with or without the mapping', () => {
  for (const old of [row(), row({ error: undefined })]) {
    const expected = old.error || 'Nothing was saved. You can resend.';
    assert.equal(notice(recoverDiaryTurns([old], wording)), expected);
    assert.equal(notice(recoverDiaryTurns([old])), expected);
  }
  // A row with a code but no reason (written before the reason existed) gets the generic sentence for its code, as live does.
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed' })], wording)), 'diary.errors.modelFailed|{}');
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed' })], wording)), live({ code: 'modelFailed' }));
});
test('an unknown or malformed reason gives the generic message for its code', () => {
  for (const reason of ['something_new', '', 42, null, { nested: 'chat_timeout' }]) {
    assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed', reason })], wording)), 'diary.errors.modelFailed|{}', JSON.stringify(reason));
  }
  // A reason on another code changes nothing, as on the live path.
  assert.equal(notice(recoverDiaryTurns([row({ code: 'contextFailed', reason: 'chat_timeout' })], wording)), 'diary.errors.contextFailed|{}');
  // A code this screen has no sentence for keeps the server's text.
  assert.equal(notice(recoverDiaryTurns([row({ code: 'someNewCode' })], wording)), SERVER_TEXT);
});
test('without the mapping a row keeps the server text whatever it carries (the call is backward compatible)', () => {
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed', reason: 'chat_timeout' })])), SERVER_TEXT);
});
test('a row whose live sentence needs the model name keeps its own text, and rows that did not fail are untouched', () => {
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelNotServed' })], wording)), SERVER_TEXT);
  const uncertain = recoverDiaryTurns([row({ state: 'uncertain', code: 'modelFailed', reason: 'chat_timeout' })], wording);
  assert.match(notice(uncertain), /uncertain/); assert.equal(uncertain[0].failed, undefined);
  const complete = recoverDiaryTurns([row({ state: 'complete', decision: 'logged', code: 'modelFailed', reason: 'chat_timeout' })], wording);
  assert.equal(notice(complete), 'Diary entry saved.');
});
test('the Diary screen passes the live mapping when it recovers rows', () => {
  const view = fs.readFileSync(path.join(SRC, 'components/DiaryView.tsx'), 'utf8');
  assert.match(view, /recoverDiaryTurns\(exchanges,\s*failure\s*=>\s*diaryErrorText\(t,\s*failure,\s*appLocale\(\)\)\)/);
});
