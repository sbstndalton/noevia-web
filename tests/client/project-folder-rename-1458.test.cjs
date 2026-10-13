'use strict';
// #1458: renaming a project left its storage folder and file paths under the old name. The folder is
// fixed at the first upload and is not moved on rename (moving live WebDAV/S3 folders is an owner
// decision), so the Sources tab now says so when the stored folder no longer carries the project's name.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { storageFolderName, storageFolderKeepsOldName } = load('src/project-files.ts');

test('the folder name mirrors the server: control and path characters become dashes, edges are trimmed', () => {
  assert.equal(storageFolderName('QA Haiku 20261012-0610'), 'QA Haiku 20261012-0610');
  assert.equal(storageFolderName('a/b:c*?'), 'a-b-c--');
  assert.equal(storageFolderName('  spaced   out  '), 'spaced out');
  assert.equal(storageFolderName('...'), 'Untitled project');
  assert.equal(storageFolderName(''), 'Untitled project');
});

test('a folder that still carries the current name is not stale, including collision suffixes', () => {
  assert.equal(storageFolderKeepsOldName('noevia projects/Alpha', 'Alpha', 'p1'), false);
  assert.equal(storageFolderKeepsOldName('noevia projects/Alpha (2)', 'Alpha', 'p1'), false);
  assert.equal(storageFolderKeepsOldName('noevia projects/Alpha--p1', 'Alpha', 'p1'), false);
});

test('a folder keyed by the project id never claims a name, so no rename can stale it', () => {
  assert.equal(storageFolderKeepsOldName('noevia projects/proj-1-a', 'Anything at all', 'proj-1-a'), false);
  assert.equal(storageFolderKeepsOldName('noevia projects/proj-1-a (2)', 'Renamed', 'proj-1-a'), false);
  assert.equal(storageFolderKeepsOldName('noevia projects/proj-1-a', 'Alpha', 'proj-2-b'), true, 'another project\'s id is not this one\'s folder');
});

test('after a rename the old folder is reported as keeping its old name', () => {
  assert.equal(storageFolderKeepsOldName('noevia projects/QA Haiku 20261012-0610', 'QA Haiku 20261012-0610 renamed', 'p1'), true);
  assert.equal(storageFolderKeepsOldName('noevia projects/Alpha--p1', 'Beta', 'p1'), true);
  assert.equal(storageFolderKeepsOldName('noevia projects/Alpha', 'Alphabet', 'p1'), true, 'a longer name is not the same folder');
});

test('the Sources tab states the folder keeps its name, and the copy is in the base catalogue', () => {
  const view = read('src/components/ProjectView.tsx');
  assert.match(view, /import \{[^}]*storageFolderKeepsOldName[^}]*\} from '\.\.\/project-files';/);
  assert.match(view, /storageFolderKeepsOldName\(project\.projectFolder, project\.name, project\.id\) && <p className="rail-empty">\{t\('projects\.view\.folderKeepsOldName'\)\}<\/p>/);
  assert.match(read('src/i18n/en-GB.ts'), /'projects\.view\.folderKeepsOldName':/);
});
