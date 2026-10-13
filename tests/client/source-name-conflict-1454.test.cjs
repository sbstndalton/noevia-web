'use strict';
// #1454: uploading a file whose name a project source already has used to replace that source with
// no notice. Such an upload is kept as a numbered copy ("notes (2).md") and the result says so, in
// both the Sources tab and the chat composer. The name helper is pure, so it is loaded from source.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { uniqueName, uploadTakenNames, uploadUnderFreeName } = load('src/project-files.ts');

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

const FOLDER = 'noevia projects/proj-1-a';
const stored = (name, group = 'Text') => ({ name: `${FOLDER}/${group}/${name}`, content: '', source: FOLDER, attachment: { id: 'x', bytes: 1, group, state: 'ready' } });

test('a stored upload is named by its storage path, and a bare upload of the same file still finds it (the live miss)', () => {
  const project = { projectFolder: FOLDER, files: [stored('qa-notes.md'), stored('scan.pdf', 'Documents'), { name: 'plain.md', content: '' }, { name: 'Linked/notes.md', content: '', source: 'Linked' }] };
  const taken = uploadTakenNames(project);
  assert.deepEqual(taken.map((t) => t.name), ['qa-notes.md', 'scan.pdf', 'plain.md']);
  assert.equal(uniqueName('qa-notes.md', taken), 'qa-notes (2).md');
  assert.equal(uniqueName('scan.pdf', taken), 'scan (2).pdf');
  assert.equal(uniqueName('notes.md', taken), 'notes.md', 'a file synced from a linked folder is a different file');
  // Before: comparing against the full path never matched, so the server replaced the source.
  assert.equal(uniqueName('qa-notes.md', project.files), 'qa-notes.md');
});

test('uploadUnderFreeName saves a taken name as a numbered copy and returns the name it used', async () => {
  const sent = [];
  const out = await uploadUnderFreeName('notes.md', [{ name: 'notes.md' }], async (n) => { sent.push(n); return 'ok'; });
  assert.deepEqual(sent, ['notes (2).md']);
  assert.deepEqual({ name: out.name, result: out.result }, { name: 'notes (2).md', result: 'ok' });
});

test('a stale list is recovered from: the server refusing a name (sourceExists) moves on to the next free number, never replaces', async () => {
  const sent = [];
  const refuse = (...names) => async (n) => { sent.push(n); if (names.includes(n)) throw Object.assign(new Error('exists'), { code: 'sourceExists' }); return 'ok'; };
  const out = await uploadUnderFreeName('notes.md', [], refuse('notes.md', 'notes (2).md'));
  assert.deepEqual(sent, ['notes.md', 'notes (2).md', 'notes (3).md']);
  assert.equal(out.name, 'notes (3).md');
});

test('any other failure is thrown as it is, with no second attempt', async () => {
  let calls = 0;
  await assert.rejects(uploadUnderFreeName('notes.md', [], async () => { calls++; throw Object.assign(new Error('storage is down'), { code: 'storageLoginRejected' }); }), /storage is down/);
  assert.equal(calls, 1);
});

test('the Sources tab keeps a taken name as a copy and says so; it never sends the raw name over a taken one', () => {
  const view = read('src/components/ProjectView.tsx');
  assert.match(view, /import \{[^}]*uploadUnderFreeName[^}]*\} from '\.\.\/project-files';/);
  assert.match(view, /const taken = uploadTakenNames\(project\);/);
  assert.match(view, /uploadUnderFreeName\(file\.name, taken, \(candidate\) => uploadProjectFile\(project\.id, \{ name: candidate, dataBase64/);
  assert.match(view, /t\('projects\.view\.savedAsCopy'/);
  assert.doesNotMatch(view, /uploadProjectFile\(project\.id, \{ name: file\.name,/);
});

test('the chat composer keeps a taken name as a copy and reports it in its status line', () => {
  const composer = read('src/components/ComposerActions.tsx');
  assert.match(composer, /import \{[^}]*uploadUnderFreeName[^}]*\} from '\.\.\/project-files';/);
  assert.match(composer, /const taken = uploadTakenNames\(project\);/);
  assert.match(composer, /uploadUnderFreeName\(file\.name, taken, \(candidate\) => uploadProjectFile\(project\.id, \{ name: candidate, dataBase64/);
  assert.match(composer, /t\('composer\.upload\.renamedCopy'/);
  assert.doesNotMatch(composer, /uploadProjectFile\(project\.id, \{ name: file\.name,/);
});

test('the new notices are in the base catalogue', () => {
  const enGB = read('src/i18n/en-GB.ts');
  for (const key of ['projects.view.savedAsCopy', 'composer.upload.renamedCopy']) {
    assert.match(enGB, new RegExp(`'${key.replace(/[.]/g, '\\.')}':`), `${key} is defined`);
  }
});
