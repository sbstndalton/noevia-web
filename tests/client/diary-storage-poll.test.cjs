const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/diary-storage-poll.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { exports: mod.exports, require: () => ({}) });
const { shouldPoll } = mod.exports;

test('complete backup does not poll', () => {
  assert.equal(shouldPoll({ backup: 'complete' }, true), false);
});

test('not_configured backup does not poll', () => {
  assert.equal(shouldPoll({ backup: 'not_configured' }, true), false);
});

test('pending backup polls while visible', () => {
  assert.equal(shouldPoll({ backup: 'pending' }, true), true);
});

test('pending backup does not poll while hidden', () => {
  assert.equal(shouldPoll({ backup: 'pending' }, false), false);
});

test('failed backup polls while visible', () => {
  assert.equal(shouldPoll({ backup: 'failed' }, true), true);
});

test('null status polls while visible', () => {
  assert.equal(shouldPoll(null, true), true);
});

test('null status does not poll while hidden', () => {
  assert.equal(shouldPoll(null, false), false);
});
