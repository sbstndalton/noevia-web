'use strict';
// #1447: a reply stopped while it is still thinking (reasoning, no answer) is labelled Stopped and its body
// reads the Stopped placeholder, like a reply stopped before any text. Loads the real catalogue and the pure
// label module from source, like locale-640-645.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, Error, console, Promise, TextEncoder,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const core = load('i18n/core');
const { EN_GB } = load('i18n/en-GB');
core.registerCatalogue('en-GB', EN_GB);
const labels = load('chat-labels');
const t = (key, params) => core.translate('en-GB', key, params);

const thinkingStop = { id: 'r1', role: 'assistant', content: '', reasoning: 'Let me work through 1234 times 5678 step by step.', senderLabel: 'Stopped' };

test('#1447 a reply stopped during its thinking is a Stopped placeholder and reads the Stopped sentence', () => {
  assert.equal(labels.isStoppedPlaceholder(thinkingStop), true);
  assert.equal(labels.messageBodyText(t, thinkingStop), 'Stopped before a reply was written.');
});

test('#1447 a reply stopped before any thought keeps the placeholder (unchanged)', () => {
  const plain = { role: 'assistant', content: '', senderLabel: 'Stopped' };
  assert.equal(labels.isStoppedPlaceholder(plain), true);
});

test('#1447 a reply that has an answer is never the placeholder, even with thinking and the Stopped label', () => {
  assert.equal(labels.isStoppedPlaceholder({ ...thinkingStop, content: 'Partial answer' }), false);
  assert.equal(labels.messageBodyText(t, { ...thinkingStop, content: 'Partial answer' }), 'Partial answer');
  assert.equal(labels.isStoppedPlaceholder({ ...thinkingStop, role: 'user' }), false);
  assert.equal(labels.isStoppedPlaceholder({ ...thinkingStop, error: true }), false);
});

test('#1447 the Stop handler labels a thinking-only reply too: its condition no longer requires empty reasoning', () => {
  const src = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  assert.match(src, /m\.id === replyId && !m\.content\s*\? \{ \.\.\.m, senderLabel: STOPPED_SENDER \}/);
  assert.doesNotMatch(src, /m\.id === replyId && !m\.content && !m\.reasoning/);
});

