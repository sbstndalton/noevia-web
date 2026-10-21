'use strict';
// #94: a Diary stream error `modelFailed` carries a `reason` when the model did not simply fail to
// answer: `chat_timeout` (the answer took too long) and `length_cap` (the length limit was reached before
// any text). Each gets its own plain sentence; an unknown or missing reason keeps the original wording.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, Intl, Number, Object, Error, String, require: (m) => load(path.posix.join(path.posix.dirname(file), m).replace(/^\.\//, '')) });
  return exports_;
}
const { diaryErrorText, diaryStreamFailure } = load('diary-errors');
const t = (key, p = {}) => `${key}|${JSON.stringify(p)}`;
const failure = (extra) => diaryStreamFailure({ type: 'error', text: 'English fallback', code: 'modelFailed', saved: false, ...extra }, 'unused');

test('chat_timeout and length_cap each get their own sentence key', () => {
  assert.equal(diaryErrorText(t, failure({ reason: 'chat_timeout' }), 'en-GB'), 'diary.errors.modelTimedOut|{}');
  assert.equal(diaryErrorText(t, failure({ reason: 'length_cap' }), 'en-GB'), 'diary.errors.modelLengthCap|{}');
});
test('an unknown, missing or non-string reason keeps the original model message', () => {
  for (const extra of [{ reason: 'something_new' }, {}, { reason: '' }, { reason: 42 }, { reason: null }, { reason: { nested: 'chat_timeout' } }]) {
    assert.equal(diaryErrorText(t, failure(extra), 'en-GB'), 'diary.errors.modelFailed|{}', JSON.stringify(extra));
  }
});
test('the reason changes nothing for the other codes', () => {
  const other = (code, extra = {}) => diaryErrorText(t, diaryStreamFailure({ code, reason: 'chat_timeout', saved: false, ...extra }, 'x'), 'en-GB');
  assert.equal(other('contextFailed'), 'diary.errors.contextFailed|{}');
  assert.equal(other('diaryUnavailable'), 'diary.errors.diaryUnavailable|{}');
  assert.equal(other('modelNotServed', { model: 'm1' }), 'diary.errors.modelNotServed|{"model":"m1"}');
  assert.equal(diaryStreamFailure({ text: 'The diary connection was interrupted.', reason: 'chat_timeout' }, 'x').saved, undefined);
});
test('the English sentences are plain and say nothing was saved', () => {
  const { EN_GB_DIARY } = load('i18n/diary/en-GB');
  assert.equal(EN_GB_DIARY['diary.errors.modelTimedOut'], 'The answer took too long. Nothing was saved, so you can resend or ask a shorter question.');
  assert.equal(EN_GB_DIARY['diary.errors.modelLengthCap'], 'The answer reached its length limit before any text appeared. Nothing was saved, so you can resend or ask for a shorter answer.');
  assert.equal(EN_GB_DIARY['diary.errors.modelFailed'], "Couldn't reach the local model. Nothing was saved, so you can resend.");
});
test('every interface language words both new sentences, and neither says the model was unreachable', () => {
  const english = load('i18n/diary/en-GB').EN_GB_DIARY;
  for (const locale of ['de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const cat = Object.values(load(`i18n/diary/${locale}`))[0];
    for (const key of ['diary.errors.modelTimedOut', 'diary.errors.modelLengthCap']) {
      assert.ok(typeof cat[key] === 'string' && cat[key].length > 20, `${locale} ${key}`);
      assert.notEqual(cat[key], english[key], `${locale} ${key} is translated`);
      assert.notEqual(cat[key], cat['diary.errors.modelFailed'], `${locale} ${key} differs from the unreachable message`);
    }
  }
});
