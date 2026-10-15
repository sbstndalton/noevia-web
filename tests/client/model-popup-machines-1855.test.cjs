'use strict';
// #1855: the Manual list shows exactly the machine rows the server sent (it already leaves out any name its served
// catalogue lists); the client applies no second filter against the installed list. Synthetic names only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.join(__dirname, '../..');
const { machineModelRows } = (() => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/model-popup-machines.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require }); return exports; })();
const row = (model) => ({ model, machine: { id: 'm1', name: 'Synthetic Pi' }, roles: ['smart'] });

test('every well-formed row the server sent is shown, whatever this machine has installed', () => {
  assert.deepEqual([...machineModelRows([row('synthetic-remote'), row('synthetic-installed-locally')]).map((r) => r.model)], ['synthetic-remote', 'synthetic-installed-locally']);
});
test('absent or malformed rows show nothing; a repeated name shows once', () => {
  assert.equal(machineModelRows(undefined).length, 0);
  assert.deepEqual([...machineModelRows([null, { model: ' ', machine: { name: 'x' } }, { model: 'a' }, row('b'), row('b')]).map((r) => r.model)], ['b']);
});
test('ModelPopup no longer filters machine rows by the installed list', () => {
  const src = fs.readFileSync(path.join(root, 'src/components/ModelPopup.tsx'), 'utf8');
  assert.match(src, /machineModelRows\(autoInfo\?\.machineModels\)/);
  assert.doesNotMatch(src, /localNames/);
});
