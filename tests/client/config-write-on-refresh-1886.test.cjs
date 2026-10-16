'use strict';
// #1886: pressing "Refresh from storage" (or anything that re-submits unchanged values) must not
// POST /config. changedProjectPatch keeps only what differs from the stored project.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const rel = (p) => fs.readFileSync(path.join(__dirname, '../../src', p), 'utf8');
const code = ts.transpileModule(rel('project-patches.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ex = {}; vm.runInNewContext(code, { exports: ex, Error });
const plain = (v) => JSON.parse(JSON.stringify(v));
const project = { id: 'p1', name: 'Finance', sourceFolders: ['/a', '/b'], routingMode: { mode: 'auto', whenSensitive: 'ask' }, pinned: false };

test('an unchanged folder list yields an empty patch (no write)', () => {
  assert.deepEqual(plain(ex.changedProjectPatch(project, { sourceFolders: ['/a', '/b'] })), {});
  assert.deepEqual(plain(ex.changedProjectPatch(project, { routingMode: { mode: 'auto', whenSensitive: 'ask' } })), {});
});
test('a real change is kept, and only that key', () => {
  assert.deepEqual(plain(ex.changedProjectPatch(project, { sourceFolders: ['/a'], name: 'Finance' })), { sourceFolders: ['/a'] });
  assert.deepEqual(plain(ex.changedProjectPatch(project, { sourceFolders: ['/b', '/a'] })), { sourceFolders: ['/b', '/a'] });
  assert.deepEqual(plain(ex.changedProjectPatch(project, { pinned: true })), { pinned: true });
});
test('an unknown project sends everything', () => {
  assert.deepEqual(plain(ex.changedProjectPatch(undefined, { name: 'x' })), { name: 'x' });
});
test('saveProjectAndSync skips the config POST for an empty patch but still syncs', () => {
  const app = rel('App.tsx');
  assert.match(app, /changedProjectPatch\(projectsRef\.current/);
  assert.match(app, /if \(hasWrite\) await saveProjectConfig/);
  assert.match(app, /Array\.isArray\(requested\.sourceFolders\)/);
});
