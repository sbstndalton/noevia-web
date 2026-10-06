'use strict';
// Removing one uploaded file must never touch synced (folder-derived) files, and must not
// silently no-op when the removed file itself is a synced one that the filter incorrectly
// dropped every other synced entry to "remove".
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { filesAfterRemoval } = load('src/project-files.ts');

test('removing one uploaded file keeps all synced files and the other uploads', () => {
  const files = [
    { name: 'a.txt', content: 'a' },
    { name: 'b.txt', content: 'b' },
    { name: 'Folder/synced1.txt', content: 's1', source: 'Folder' },
    { name: 'Folder/synced2.txt', content: 's2', source: 'Folder' },
  ];
  const next = filesAfterRemoval(files, 'a.txt');
  assert.deepEqual(next.map(f => f.name), ['b.txt', 'Folder/synced1.txt', 'Folder/synced2.txt']);
});

test('removing a synced file by name drops only that one, not every synced file', () => {
  const files = [
    { name: 'a.txt', content: 'a' },
    { name: 'Folder/synced1.txt', content: 's1', source: 'Folder' },
    { name: 'Folder/synced2.txt', content: 's2', source: 'Folder' },
  ];
  const next = filesAfterRemoval(files, 'Folder/synced1.txt');
  assert.deepEqual(next.map(f => f.name), ['a.txt', 'Folder/synced2.txt']);
});

test('removing an entry that is not present leaves the list unchanged', () => {
  const files = [{ name: 'a.txt', content: 'a' }];
  assert.deepEqual(filesAfterRemoval(files, 'missing.txt'), files);
});
