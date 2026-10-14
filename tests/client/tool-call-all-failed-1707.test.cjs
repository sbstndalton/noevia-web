'use strict';
// #1707: a fetch/extract result where every URL is in failed_results (and none in results) is a failed
// call, not "0 results"; some URLs failing stays a success with a note. Synthetic results only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const src = (p) => fs.readFileSync(path.join(__dirname, '../../src', p), 'utf8');
const summary = {};
new Function('exports', ts.transpileModule(src('tool-result-summary.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(summary);
const { summariseToolResult } = summary;
const component = src('components/ToolCalls.tsx');
const helper = /export function toolCallRowState[\s\S]*?\n}\n/.exec(component);
const exportsObj = {};
new Function('exports', 'summariseToolResult', ts.transpileModule(helper[0], { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exportsObj, summariseToolResult);
const state = exportsObj.toolCallRowState;

const failedUrl = (i) => ({ url: `https://qa-1707-${i}.invalid/page`, error: 'Failed to fetch url' });
const allFailed1 = JSON.stringify({ results: [], failed_results: [failedUrl(1)], response_time: 0.01 });
const allFailed3 = JSON.stringify({ results: [], failed_results: [failedUrl(1), failedUrl(2), failedUrl(3)] });
const partial = JSON.stringify({ results: [{ url: 'https://example.invalid/ok', raw_content: 'synthetic' }], failed_results: [failedUrl(2)] });
const emptyOk = JSON.stringify({ results: [], failed_results: [] });

test('#1707 every URL failed is allFailed with the failed count, and never names a URL', () => {
  assert.deepEqual(summariseToolResult(allFailed1), { kind: 'allFailed', failed: 1 });
  assert.deepEqual(summariseToolResult(allFailed3), { kind: 'allFailed', failed: 3 });
  assert.ok(!JSON.stringify(summariseToolResult(allFailed3)).includes('invalid'));
  assert.deepEqual(summariseToolResult(JSON.stringify({ failed_results: [failedUrl(1)] })), { kind: 'allFailed', failed: 1 }, 'no results array at all');
});

test('#1707 partial failure is a search result with a failed note; an empty success stays 0 results', () => {
  assert.deepEqual(summariseToolResult(partial), { kind: 'search', results: 1, failed: 1 });
  assert.deepEqual(summariseToolResult(emptyOk), { kind: 'search', results: 0 });
});

test('#1707 row state: all failed is the error state, partial and empty successes stay done', () => {
  assert.equal(state({ status: 'done', result: allFailed1 }), 'error');
  assert.equal(state({ status: 'done', result: allFailed3 }), 'error');
  assert.equal(state({ status: 'done', result: partial }), 'done');
  assert.equal(state({ status: 'done', result: emptyOk }), 'done');
  assert.equal(state({ status: 'denied', result: allFailed1 }), 'declined');
});

test('#1707 every catalogue words the all-failed and some-failed previews', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '../../src/i18n')).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts')) {
    for (const key of ['allFailed.one', 'allFailed.other', 'someFailed.one', 'someFailed.other']) {
      assert.match(src(`i18n/${f}`), new RegExp(`'chat\\.toolCalls\\.summary\\.${key.replace('.', '\\.')}': "[^"]*\\{count\\}[^"]*"`), `${f} ${key}`);
    }
  }
});
