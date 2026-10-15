'use strict';
// #1805: the client half of a folder import: the shared skip list collapses a skipped folder into
// one row, only readable types become candidates, a dropped folder is walked breadth-first (with
// readEntries batches) without entering node_modules or .git, and Sources shows a source's path
// inside its folder so two same-named files are told apart. Also: the "Add folder" control, its
// labelled directory input and the once-only announcement are wired in ProjectView, every string
// exists in every catalogue, and the pinned contract is the one the server reads. Synthetic only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const root = path.join(__dirname, '../..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'contracts/folder-import.json'), 'utf8'));
function load() {
  const exports_ = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/folder-import.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports: exports_, require: (id) => { if (id !== '../contracts/folder-import.json') throw Error(`unexpected require ${id}`); return contract; }, Array, Map, Set, Promise, Uint8Array, globalThis: {}, Object });
  return exports_;
}
const realm = load();
// Plain values from the vm realm, so deepEqual compares structure, not prototypes.
const plain = (v) => JSON.parse(JSON.stringify(v));
const fi = { ...realm, sortFolder: (x) => plain(realm.sortFolder(x)), fromInput: (x) => plain(realm.fromInput(x).map((i) => ({ path: i.path }))), fromDrop: async (x) => plain(await realm.fromDrop(x)) };
const file = (name, size = 3) => ({ name, size });

test('#1805: sortFolder keeps readable files, folds each skipped folder into one row and says why', () => {
  const items = [
    'notes/readme.md', 'notes/docs/readme.md', 'notes/docs/api/auth.md', 'notes/tool.exe', 'notes/.DS_Store',
    'notes/.git/config', 'notes/.git/HEAD', 'notes/node_modules/a/index.js', 'notes/node_modules/a/readme.md', 'notes/node_modules/b/x.js', 'notes/web/dist/app.js',
  ].map((p) => ({ file: file(p.split('/').pop()), path: p }));
  const { candidates, skipped } = fi.sortFolder(items);
  assert.deepEqual(candidates.map((c) => c.path), ['notes/readme.md', 'notes/docs/readme.md', 'notes/docs/api/auth.md']);
  const rows = Object.fromEntries(skipped.map((s) => [s.path, [s.code, s.count || 0]]));
  assert.deepEqual(rows, {
    'notes/.git': ['system', 2], 'notes/node_modules': ['system', 3], 'notes/web/dist': ['system', 1],
    'notes/tool.exe': ['unsupported', 0], 'notes/.DS_Store': ['system', 0],
  });
});

test('#1805: fromInput takes each file\'s path inside the chosen folder', () => {
  const picked = [Object.assign(file('auth.md'), { webkitRelativePath: 'notes/docs/api/auth.md' }), file('loose.md')];
  assert.deepEqual(fi.fromInput(picked).map((x) => x.path), ['notes/docs/api/auth.md', 'loose.md']);
});

/** A synthetic dropped tree in the File and Directory Entries shape, with readEntries in batches of 2. */
function entryTree(spec, base = '') {
  return Object.entries(spec).map(([name, value]) => {
    const fullPath = `${base}/${name}`;
    if (typeof value === 'string') return { isFile: true, isDirectory: false, name, fullPath, file: (ok) => ok({ name, size: value.length }) };
    const children = entryTree(value, fullPath);
    const opened = [];
    return { isFile: false, isDirectory: true, name, fullPath, opened, createReader() { let at = 0; opened.push(1); return { readEntries(ok) { const batch = children.slice(at, at + 2); at += batch.length; ok(batch); } }; } };
  });
}

test('#1805: a dropped folder is walked to every level in batches, and node_modules and .git are never opened', async () => {
  const [rootEntry] = entryTree({ notes: { 'readme.md': 'a', docs: { 'readme.md': 'b', api: { 'auth.md': 'c' } }, '.git': { config: 'x' }, node_modules: { a: { 'i.js': 'y' } }, 'z.md': 'd', 'y.md': 'e' } });
  const items = [{ kind: 'file', webkitGetAsEntry: () => rootEntry }];
  const out = await fi.fromDrop(items);
  assert.deepEqual(out.files.map((f) => f.path).sort(), ['notes/docs/api/auth.md', 'notes/docs/readme.md', 'notes/readme.md', 'notes/y.md', 'notes/z.md']);
  assert.deepEqual(out.skipped.map((s) => [s.path, s.code]).sort(), [['notes/.git', 'system'], ['notes/node_modules', 'system']]);
  assert.equal(out.folders, 3);
});

test('#1805: Sources shows the path inside the folder, so same-named files differ; plain uploads look as before', () => {
  const pf = 'noevia projects/Alpha';
  const show = (f) => fi.sourceDisplayPath(f, pf);
  assert.equal(show({ name: `${pf}/Text/docs/readme.md`, source: pf, attachment: { group: 'Text' } }), 'docs/readme.md');
  assert.equal(show({ name: `${pf}/Text/notes/readme.md`, source: pf, attachment: { group: 'Text' } }), 'notes/readme.md');
  assert.equal(show({ name: `${pf}/Text/report.md`, source: pf, attachment: { group: 'Text' } }), 'report.md');
  assert.equal(show({ name: 'Shared/Team/docs/api/auth.md', source: 'Shared/Team' }), 'docs/api/auth.md');
  assert.equal(show({ name: 'a/readme.md', source: null }), 'a/readme.md', 'without storage the name is the relative path');
});

test('#1805: ProjectView offers a labelled "Add folder" directory input and drop target, and announces the result once', () => {
  const view = fs.readFileSync(path.join(root, 'src/components/ProjectView.tsx'), 'utf8');
  assert.match(view, /setAttribute\('webkitdirectory', ''\)/);
  assert.match(view, /aria-label=\{t\('projects\.folder\.inputLabel'\)\}/);
  assert.match(view, /t\('projects\.folder\.add'\)/);
  assert.match(view, /onDrop=\{onSourcesDrop\}/);
  assert.match(view, /webkitGetAsEntry/);
  assert.match(view, /role="status">\{folderAnnouncement\}/);
  assert.match(view, /aria-live=\{folderMode \? 'off' : 'polite'\}/, 'per-file rows stay quiet during a folder import');
});

test('#1805: every folder-import string exists in all nine catalogues', () => {
  const english = fs.readFileSync(path.join(root, 'src/i18n/en-GB.ts'), 'utf8');
  const keys = [...english.matchAll(/'(projects\.folder\.[A-Za-z.]+)'/g)].map((m) => m[1]);
  assert.equal(keys.length, 24, `found ${keys.length}`);
  for (const locale of ['de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const text = fs.readFileSync(path.join(root, `src/i18n/${locale}.ts`), 'utf8');
    for (const key of keys) assert.ok(text.includes(`'${key}'`), `${locale} has ${key}`);
  }
});
