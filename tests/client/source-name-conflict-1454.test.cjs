'use strict';
// #1454: uploading a file whose name a project source already has used to replace that source with
// no notice. Such an upload is kept as a numbered copy ("notes (2).md") and the result says so, in
// both the Sources tab and the chat composer. The name helper is pure, so it is loaded from source.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { uniqueName } = load('src/project-files.ts');

test('a free name is kept as it is', () => {
  assert.equal(uniqueName('notes.md', [{ name: 'other.md' }]), 'notes.md');
  assert.equal(uniqueName('notes.md', []), 'notes.md');
});

test('a taken name becomes the first free numbered copy, keeping the extension', () => {
  assert.equal(uniqueName('qa-fixture-a.md', [{ name: 'qa-fixture-a.md' }]), 'qa-fixture-a (2).md');
  assert.equal(uniqueName('qa-fixture-a.md', [{ name: 'qa-fixture-a.md' }, { name: 'qa-fixture-a (2).md' }]), 'qa-fixture-a (3).md');
  assert.equal(uniqueName('README', [{ name: 'README' }]), 'README (2)');
  assert.equal(uniqueName('.env', [{ name: '.env' }]), '.env (2)', 'a leading dot is not an extension');
});

test('a folder-qualified source does not block a bare upload of the same last segment', () => {
  assert.equal(uniqueName('notes.md', [{ name: 'Folder/notes.md' }]), 'notes.md');
});

test('the Sources tab keeps a taken name as a copy and says so; it never sends the raw name over a taken one', () => {
  const view = read('src/components/ProjectView.tsx');
  assert.match(view, /import \{[^}]*uniqueName[^}]*\} from '\.\.\/project-files';/);
  assert.match(view, /const name = uniqueName\(file\.name, taken\);/);
  assert.match(view, /uploadProjectFile\(project\.id, \{ name, dataBase64/);
  assert.match(view, /t\('projects\.view\.savedAsCopy'/);
  assert.doesNotMatch(view, /uploadProjectFile\(project\.id, \{ name: file\.name,/);
});

test('the chat composer keeps a taken name as a copy and reports it in its status line', () => {
  const composer = read('src/components/ComposerActions.tsx');
  assert.match(composer, /import \{[^}]*uniqueName[^}]*\} from '\.\.\/project-files';/);
  assert.match(composer, /const name = uniqueName\(file\.name, taken\);/);
  assert.match(composer, /uploadProjectFile\(project\.id, \{ name, dataBase64/);
  assert.match(composer, /t\('composer\.upload\.renamedCopy'/);
  assert.doesNotMatch(composer, /uploadProjectFile\(project\.id, \{ name: file\.name,/);
});

test('the new notices are in the base catalogue', () => {
  const enGB = read('src/i18n/en-GB.ts');
  for (const key of ['projects.view.savedAsCopy', 'composer.upload.renamedCopy']) {
    assert.match(enGB, new RegExp(`'${key.replace(/[.]/g, '\\.')}':`), `${key} is defined`);
  }
});
