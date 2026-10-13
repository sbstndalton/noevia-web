'use strict';
// #1582: Usage ("Favourite model") and Settings > Models & routing showed raw GGUF file identifiers
// ("gemma-4-E2B_q4_0-it", "Qwen3.5-9B-UD-Q4_K_XL") as model labels.
// The server sends no display name for an installed model (only its router id), so the fallback is:
// drop a .gguf extension and the quantisation tag, for display only. Keys, roles and requests keep the id.
// Synthetic names only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function load(rel, requireMap = {}) {
  const exports_ = {};
  const code = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports: exports_, Object, Array, String,
    require: (id) => { if (!(id in requireMap)) throw Error(`unexpected require ${id}`); return requireMap[id]; },
  });
  return exports_;
}

const { modelDisplayName, displayNamer } = load('model-display-name.ts');

test('#1582 a quantised file identifier shows without its quantisation tag', () => {
  assert.equal(modelDisplayName('gemma-4-E2B_q4_0-it'), 'gemma-4-E2B-it');
  assert.equal(modelDisplayName('gemma-4-12b-it-qat-q4_0'), 'gemma-4-12b-it');
  assert.equal(modelDisplayName('Qwen3.5-9B-UD-Q4_K_XL'), 'Qwen3.5-9B');
  assert.equal(modelDisplayName('Qwen3.5-4B-UD-Q8_K_XL'), 'Qwen3.5-4B');
  assert.equal(modelDisplayName('llama-3-8b-instruct-q4_k_m'), 'llama-3-8b-instruct');
  assert.equal(modelDisplayName('Mistral-7B-Instruct-v0.3-Q6_K'), 'Mistral-7B-Instruct-v0.3');
});

test('#1582 a .gguf extension is dropped, with or without a quantisation tag before it', () => {
  assert.equal(modelDisplayName('model.Q5_K_M.gguf'), 'model');
  assert.equal(modelDisplayName('Qwen3.5-9B.GGUF'), 'Qwen3.5-9B');
});

test('#1582 names with no quantisation tag are shown as they are', () => {
  assert.equal(modelDisplayName('nomic-embed-text-v1'), 'nomic-embed-text-v1');
  assert.equal(modelDisplayName('Qwen3.5'), 'Qwen3.5');
  assert.equal(modelDisplayName('bge-m3'), 'bge-m3');
  assert.equal(modelDisplayName('Q4_K_M'), 'Q4_K_M', 'a bare tag with no name before it is left alone');
});

test('#1582 the display name is never empty, and the helper is pure text (it does not decide which model is meant)', () => {
  assert.equal(typeof modelDisplayName(''), 'string');
  assert.equal(modelDisplayName(''), '');
  assert.equal(modelDisplayName('a-q4_0'), 'a');
});

test('#1582 the Models & routing summary words its installed and loaded models by display name (ids in, names out)', () => {
  const { installedSummary } = load('models-summary.ts');
  const { modelDisplayName: display } = load('model-display-name.ts');
  const models = [
    { name: 'gemma-4-E2B_q4_0-it', loaded: true },
    { name: 'nomic-embed-text-v1', loaded: false },
    { name: 'Qwen3.5-9B-UD-Q4_K_XL', loaded: true },
  ];
  const words = { count: (n) => `${n} models`, loaded: (names) => `loaded: ${names}`, noneLoaded: 'none loaded' };
  // ModelsSummary maps the names before the pure summary reads them; the summary itself is unchanged.
  const named = (list) => list.map((m) => ({ ...m, name: display(m.name) }));
  assert.equal(installedSummary(named(models), words), '3 models · loaded: gemma-4-E2B-it, Qwen3.5-9B');
  assert.equal(installedSummary(named([{ name: 'x_q4_0', loaded: false }]), words), '1 models · none loaded', 'the count is unchanged');
});

test('#1582 two ids that would read the same keep their quantisation tag on the same screen', () => {
  const name = displayNamer(['gemma-4-E2B_q4_0-it', 'gemma-4-E2B_q8_0-it', 'nomic-embed-text-v1', 'Qwen3.5-9B-UD-Q4_K_XL']);
  assert.equal(name('gemma-4-E2B_q4_0-it'), 'gemma-4-E2B_q4_0-it', 'clashing names keep the tag');
  assert.equal(name('gemma-4-E2B_q8_0-it'), 'gemma-4-E2B_q8_0-it');
  assert.equal(name('nomic-embed-text-v1'), 'nomic-embed-text-v1');
  assert.equal(name('Qwen3.5-9B-UD-Q4_K_XL'), 'Qwen3.5-9B', 'a name that does not clash is shortened');
  const alone = displayNamer(['gemma-4-E2B_q4_0-it']);
  assert.equal(alone('gemma-4-E2B_q4_0-it'), 'gemma-4-E2B-it', 'with nothing to clash with, the tag goes');
  assert.equal(displayNamer(['model.gguf', 'model-Q4_K_M'])('model.gguf'), 'model.gguf'.replace(/\.gguf$/, ''), 'the extension goes when there is no clash');
});

test('#1582 the summary card and the Usage page show display names, not the raw ids', () => {
  const summary = read('components/models/ModelsSummary.tsx');
  assert.match(summary, /import \{ displayNamer \} from '\.\.\/\.\.\/model-display-name';/);
  assert.match(summary, /const nameOf = displayNamer\(/, 'one namer for the installed list and the roles, so clashes are seen together');
  assert.match(summary, /nameOf\(roles\.roles\.fast\)/);
  assert.match(summary, /nameOf\(roles\.roles\.smart\)/);
  assert.match(summary, /nameOf\(roles\.roles\.vision\)/);
  assert.match(summary, /installedSummary\(models\.map\(\(m\) => \(\{ \.\.\.m, name: nameOf\(m\.name\) \}\)\)/);
  const usage = read('components/UsageView.tsx');
  assert.match(usage, /import \{ modelDisplayName \} from '\.\.\/model-display-name';/);
  assert.match(usage, /value=\{data\.models\[0\]\?\.name \? modelDisplayName\(data\.models\[0\]\.name\) : '—'\}/);
});
