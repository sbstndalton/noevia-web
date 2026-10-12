'use strict';
// #1524: a collapsed tool-call row says what a result contained (a count, a plain word), not the raw
// JSON, and never a file or folder name. Synthetic results only; no network, no server.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
// Loaded in this realm (not vm), so the returned objects compare with deepEqual.
const summaryModule = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/tool-result-summary.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(summaryModule);
const { summariseToolResult } = summaryModule;

// The shape the Nextcloud list returns (names are synthetic and must never reach a collapsed row).
const listing = JSON.stringify({ success: true, timestamp: '2026-10-12T14:02:04Z', path: '', files: [
  { name: 'Synthetic Folder A', path: 'Synthetic Folder A', isDirectory: true },
  { name: 'Synthetic Folder B', path: 'Synthetic Folder B', isDirectory: true },
  { name: 'synthetic-note.md', path: 'synthetic-note.md', isDirectory: false },
] });
const search = JSON.stringify({ follow_up_questions: null, answer: null, images: [], results: [
  { title: 'Synthetic result one', url: 'https://example.invalid/one', content: 'x'.repeat(40) },
  { title: 'Synthetic result two', url: 'https://example.invalid/two', content: 'y'.repeat(40) },
] });

test('#1524: a Nextcloud folder listing is a count, with no file or folder name in it', () => {
  const summary = summariseToolResult(listing);
  assert.deepEqual(summary, { kind: 'listed', items: 3 });
  assert.ok(!JSON.stringify(summary).includes('Synthetic'), 'no name reaches the collapsed row');
});

test('#1524: a web search result is a count of results, not the answer or the links', () => {
  const summary = summariseToolResult(search);
  assert.deepEqual(summary, { kind: 'search', results: 2 });
  assert.ok(!JSON.stringify(summary).includes('example.invalid'));
});

test('#1524: a failed call says it returned an error, and a structured result of unknown shape says it was received', () => {
  assert.deepEqual(summariseToolResult(JSON.stringify({ success: false, error: 'synthetic failure' })), { kind: 'error' });
  assert.deepEqual(summariseToolResult(JSON.stringify({ error: 'synthetic failure' })), { kind: 'error' });
  assert.deepEqual(summariseToolResult(JSON.stringify({ success: true, value: 7 })), { kind: 'received' });
});

test('#1524: plain text results, malformed JSON and JSON arrays are kept as text, as before', () => {
  assert.deepEqual(summariseToolResult('Current time: Mon Oct 12 2026 14:02:04 GMT+0000'), { kind: 'text', text: 'Current time: Mon Oct 12 2026 14:02:04 GMT+0000' });
  assert.deepEqual(summariseToolResult('{"files": [1,'), { kind: 'text', text: '{"files": [1,' });
  assert.deepEqual(summariseToolResult('[1,2,3]'), { kind: 'text', text: '[1,2,3]' });
  assert.deepEqual(summariseToolResult(''), { kind: 'text', text: '' });
});

// The row and its labels: the collapsed preview goes through the summary, a running call never shows
// its raw arguments, and every catalogue key the row uses exists in the base (en-GB) catalogue.
test('#1524: the tool-call row uses the summary and never prints a running call\'s raw arguments', () => {
  const component = fs.readFileSync(path.join(__dirname, '../../src/components/ToolCalls.tsx'), 'utf8');
  assert.match(component, /resultPreview\(c\.result, t, n\)/);
  assert.match(component, /state === 'running' \? t\('chat\.toolCalls\.summary\.running'\)/);
  assert.doesNotMatch(component, /c\.args \? oneLine\(c\.args\)/, 'the raw arguments are not the row text');
  const base = fs.readFileSync(path.join(__dirname, '../../src/i18n/en-GB.ts'), 'utf8');
  for (const key of ['chat.toolCalls.summary.listed.one', 'chat.toolCalls.summary.listed.other', 'chat.toolCalls.summary.search.one', 'chat.toolCalls.summary.search.other', 'chat.toolCalls.summary.error', 'chat.toolCalls.summary.received', 'chat.toolCalls.summary.running']) {
    assert.ok(base.includes(`'${key}':`), `${key} is in the base catalogue`);
  }
});
