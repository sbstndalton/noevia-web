// #2460: the key table behind the Models page tab list (the browser proof is qa/models-tabs-2459-2460.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/tab-keys.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exports_ });
const { nextTabIndex } = exports_;

test('ArrowRight and ArrowLeft step with wrap-around', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 4), 1);
  assert.equal(nextTabIndex('ArrowRight', 3, 4), 0);
  assert.equal(nextTabIndex('ArrowLeft', 2, 4), 1);
  assert.equal(nextTabIndex('ArrowLeft', 0, 4), 3);
});

test('Home and End go to the ends; other keys and an empty list do nothing', () => {
  assert.equal(nextTabIndex('Home', 2, 4), 0);
  assert.equal(nextTabIndex('End', 1, 4), 3);
  assert.equal(nextTabIndex('ArrowDown', 1, 4), null);
  assert.equal(nextTabIndex('Enter', 1, 4), null);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), null);
});
