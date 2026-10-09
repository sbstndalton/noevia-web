'use strict';
// #1168: a storage throttle is worded with its wait; the wait uses the interface locale's own units;
// a missing wait still gives a sentence; other codes are unchanged. Pure modules loaded from source.
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
const { diaryErrorText, formatWait } = load('diary-errors');
const t = (key, p = {}) => `${key}|${JSON.stringify(p)}`;

test('formatWait: seconds below two minutes, whole minutes above, in the locale', () => {
  assert.equal(formatWait(42, 'en-GB'), '42 seconds');
  assert.equal(formatWait(0.2, 'en-GB'), '1 second');
  assert.equal(formatWait(119, 'en-GB'), '119 seconds');
  assert.equal(formatWait(121, 'en-GB'), '3 minutes');
  assert.match(formatWait(42, 'de-DE'), /42 Sekunden/);
});
test('a throttle names its wait, or says to wait a little when none was given', () => {
  assert.equal(diaryErrorText(t, { code: 'storageThrottled', retryAfter: 42, message: 'x' }, 'en-GB'), 'storage.throttledWait|{"wait":"42 seconds"}');
  assert.equal(diaryErrorText(t, { code: 'storageThrottled', message: 'x' }, 'en-GB'), 'storage.throttled|{}');
  assert.equal(diaryErrorText(t, { code: 'storageLoginRejected' }, 'en-GB'), 'storage.refreshLoginRejected|{}');
  assert.equal(diaryErrorText(t, new Error('plain'), 'en-GB'), 'plain');
});
