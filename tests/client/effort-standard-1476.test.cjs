'use strict';
// #1476: a Standard reply (no effort parameter sent, mode "off") names its effort on the turn ("Effort:
// standard · model default") instead of showing nothing. Loads the real catalogue and the pure label module
// from source, like locale-640-645.
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

test('#1476 a Standard reply (mode off) names its effort on the turn', () => {
  assert.equal(labels.effortLineText(t, 'default', 'off'), 'Effort: standard · model default');
});

test('#1476 Low and High keep their wording: provider parameter, or best-effort hint', () => {
  assert.equal(labels.effortLineText(t, 'low', 'real'), 'Effort: low · provider parameter');
  assert.equal(labels.effortLineText(t, 'high', 'hint'), 'Effort: high · best-effort hint');
});

test('#1476 the chat view draws the effort line for every reply that recorded a mode, Standard included', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/ChatView.tsx'), 'utf8');
  assert.match(src, /\{m\.reasoningMode && <small className="reasoning-result">\{effortLineText\(t, m\.reasoningEffort, m\.reasoningMode\)\}<\/small>\}/);
  assert.doesNotMatch(src, /reasoningMode !== 'off'/);
});

