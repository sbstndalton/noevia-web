'use strict';
// The double-click / stale-approval guard CodePanel uses before sending a decision: a decision
// is only forwarded when the approval id bound at render time still matches what is live.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { isDecisionStale } = load('src/components/code/decision-guard.ts');

test('matching ids are not stale', () => {
  assert.equal(isDecisionStale('appr-1', 'appr-1'), false);
});
test('a different live id (the task moved to a new approval, or resolved) is stale', () => {
  assert.equal(isDecisionStale('appr-2', 'appr-1'), true);
});
test('no live approval at all (task finished) is stale', () => {
  assert.equal(isDecisionStale(undefined, 'appr-1'), true);
  assert.equal(isDecisionStale(null, 'appr-1'), true);
});
