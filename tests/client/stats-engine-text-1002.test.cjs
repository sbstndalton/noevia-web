// noevia#1002: a chat request that failed before the engine ran showed "Unavailable from engine"
// under GPU and Engine total, which read as a GPU fault. engineEmptyKey (stats-engine-text.ts) is
// the pure rule StatsBar uses for those rows; tested directly, plus a guard on the render.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadPure(relPath) {
  const file = path.join(__dirname, '..', relPath);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => ({}) });
  return exports;
}

const { engineEmptyKey } = loadPure('../src/stats-engine-text.ts');
const reply = (o) => ({ phase: 'complete', model: 'synthetic', timeToFirstToken: null, inputTokens: null, outputTokens: null, totalTokens: null, tokensPerSecond: null, mtp: [], ...o });

test('a reply that failed before any output says Not reported', () => {
  assert.equal(engineEmptyKey(reply({ phase: 'error' })), 'stats.notReported');
});

test('anything else keeps Unavailable from engine', () => {
  assert.equal(engineEmptyKey(null), 'stats.unavailable');
  assert.equal(engineEmptyKey(undefined), 'stats.unavailable');
  assert.equal(engineEmptyKey(reply({ phase: 'complete' })), 'stats.unavailable');
  assert.equal(engineEmptyKey(reply({ phase: 'waiting' })), 'stats.unavailable');
  assert.equal(engineEmptyKey(reply({ phase: 'error', timeToFirstToken: 0.4 })), 'stats.unavailable', 'the engine ran, then failed');
  assert.equal(engineEmptyKey(reply({ phase: 'error', inputTokens: 12 })), 'stats.unavailable');
});

test('both engine rows of StatsBar use the rule, and the strings exist', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/StatsBar.tsx'), 'utf8');
  assert.equal(src.match(/: t\(engineEmptyKey\(reply\)\)/g).length, 2);
  assert.doesNotMatch(src, /: t\('stats\.unavailable'\)/);
  const en = fs.readFileSync(path.join(__dirname, '../../src/i18n/en-GB.ts'), 'utf8');
  assert.match(en, /'stats\.notReported': /);
  assert.match(en, /'stats\.unavailable': 'Unavailable from engine'/);
});
