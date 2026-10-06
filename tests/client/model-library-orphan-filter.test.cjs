const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  return m.exports;
}
const { filterOrphanFiles } = load('components/models/orphan-files.ts');

const files = [
  { name: 'setup-a.gguf' },
  { name: 'setup-b.gguf' },
  { name: 'random-cache-file' },
];

test('a zero-result search hides unrelated setup files (#174)', () => {
  assert.deepEqual(filterOrphanFiles(files, 'zzzz-no-model', 'all'), []);
});

test('the Loaded filter hides setup files, which are never loaded (#174)', () => {
  assert.deepEqual(filterOrphanFiles(files, '', 'loaded'), []);
});

test('the vision filter also hides setup files, since orphan files have no vision info (#174)', () => {
  assert.deepEqual(filterOrphanFiles(files, '', 'vision'), []);
});

test('the unconfigured filter still shows setup files: they are exactly what it means', () => {
  assert.deepEqual(filterOrphanFiles(files, '', 'unconfigured'), files);
});

test('a matching search still narrows the setup file list like any other list', () => {
  assert.deepEqual(filterOrphanFiles(files, 'setup-a', 'all'), [{ name: 'setup-a.gguf' }]);
});

test('the default All filter with no search keeps every setup file', () => {
  assert.deepEqual(filterOrphanFiles(files, '', 'all'), files);
});
