'use strict';
// #1694: a finished tool call whose result is an error has its own row state (x icon, danger colour,
// "failed" label), never the success check. Synthetic results only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const src = (p) => fs.readFileSync(path.join(__dirname, '../../src', p), 'utf8');
const summary = {};
new Function('exports', ts.transpileModule(src('tool-result-summary.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(summary);
// Only the pure state helper is evaluated; the component's React imports are not needed for it.
const component = src('components/ToolCalls.tsx');
const helper = /export function toolCallRowState[\s\S]*?\n}\n/.exec(component);

test('#1694 ToolCalls exports a row-state helper', () => assert.ok(helper, 'toolCallRowState is defined in ToolCalls.tsx'));

test('#1694 an error result is the error state; success, declined, stopped and running keep theirs', () => {
  const js = ts.transpileModule(helper[0], { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'summariseToolResult', js)(exports, summary.summariseToolResult);
  const state = exports.toolCallRowState;
  assert.equal(state({ status: 'done', result: JSON.stringify({ error: 'synthetic failure' }) }), 'error');
  assert.equal(state({ status: 'done', result: JSON.stringify({ success: false, error: 'synthetic' }) }), 'error');
  assert.equal(state({ status: 'done', result: 'Synthetic research summary.' }), 'done');
  assert.equal(state({ status: 'done' }), 'done');
  assert.equal(state({ status: 'denied', result: 'ERROR: the user declined this action.' }), 'declined');
  assert.equal(state({ status: 'stopped' }), 'not run');
  assert.equal(state({ status: 'running' }), 'running');
});

test('#1694 the error state has an x icon, a danger colour and a "failed" label in every catalogue', () => {
  assert.match(component, /error: 'x'/);
  assert.match(src('styles/overlays.css'), /\.tool-call\.is-error \.tool-call-state \{ color: var\(--status-danger\); \}/);
  for (const f of fs.readdirSync(path.join(__dirname, '../../src/i18n')).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts')) {
    assert.match(src(`i18n/${f}`), /'chat\.toolCalls\.state\.error': "[^"]+"/, `${f} names the error state`);
  }
});
