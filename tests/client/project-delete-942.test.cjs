'use strict';
// #942: the project delete flow. Loads src/project-patches.ts from source (like byte-format.test.cjs)
// and drives its debounce with node:test fake timers; checks the new messages exist in every locale.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const src = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');
const code = ts.transpileModule(src('project-patches.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

// Objects built inside the vm have another Object prototype; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));

function load() {
  // The module reads the global timer functions when called, so mock.timers reaches it.
  const ex = {};
  vm.runInNewContext(code, { exports: ex, setTimeout: (...a) => setTimeout(...a), clearTimeout: (h) => clearTimeout(h), Error });
  return ex;
}

test('a delete cancels the pending debounced patch, so no save fires for the deleted project', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { queueProjectPatch, takeProjectPatch } = load();
  const q = { timers: {}, pending: {} };
  const flushed = [];
  queueProjectPatch(q, 'p1', { pinned: true }, 600, (id, merged) => flushed.push([id, merged]));
  queueProjectPatch(q, 'p2', { archived: true }, 600, (id, merged) => flushed.push([id, merged]));
  t.mock.timers.tick(300);
  const held = takeProjectPatch(q, 'p1');
  assert.deepEqual(plain(held), { pinned: true });
  assert.equal(q.timers.p1, undefined);
  assert.equal(q.pending.p1, undefined);
  t.mock.timers.tick(1000);
  assert.deepEqual(plain(flushed), [['p2', { archived: true }]], 'only the other project saves');
});

test('without a delete, patches within the debounce merge and save once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { queueProjectPatch } = load();
  const q = { timers: {}, pending: {} };
  const flushed = [];
  queueProjectPatch(q, 'p1', { pinned: true }, 600, (id, m) => flushed.push([id, m]));
  t.mock.timers.tick(400);
  queueProjectPatch(q, 'p1', { archived: true }, 600, (id, m) => flushed.push([id, m]));
  t.mock.timers.tick(599);
  assert.equal(flushed.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(plain(flushed), [['p1', { pinned: true, archived: true }]]);
});

test('a failed delete puts the held patch back, newer edits winning, and it still saves', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { queueProjectPatch, takeProjectPatch, restoreProjectPatch } = load();
  const q = { timers: {}, pending: {} };
  const flushed = [];
  const flush = (id, m) => flushed.push([id, m]);
  queueProjectPatch(q, 'p1', { pinned: true, archived: true }, 600, flush);
  const held = takeProjectPatch(q, 'p1');
  queueProjectPatch(q, 'p1', { archived: false }, 600, flush); // edited while the DELETE was in flight
  restoreProjectPatch(q, 'p1', held, flush);
  t.mock.timers.tick(0);
  assert.deepEqual(plain(flushed), [['p1', { pinned: true, archived: false }]]);
  t.mock.timers.tick(1000);
  assert.equal(flushed.length, 1, 'the replaced timer never fires a second save');
  restoreProjectPatch(q, 'p1', undefined, flush);
  t.mock.timers.tick(1000);
  assert.equal(flushed.length, 1, 'nothing held, nothing saved');
});

test('only the deleted project, or one of its chats, counts as the current view', () => {
  const { viewBelongsToProject } = load();
  const owner = (id) => ({ c1: 'p1', c2: null }[id]);
  assert.equal(viewBelongsToProject({ kind: 'project', id: 'p1' }, 'p1', owner), true);
  assert.equal(viewBelongsToProject({ kind: 'project', id: 'p2' }, 'p1', owner), false);
  assert.equal(viewBelongsToProject({ kind: 'chat', chatId: 'cx', projectId: 'p1' }, 'p1', owner), true);
  assert.equal(viewBelongsToProject({ kind: 'chat', chatId: 'c1', projectId: null }, 'p1', owner), true, 'a chat opened by address');
  assert.equal(viewBelongsToProject({ kind: 'chat', chatId: 'c2', projectId: null }, 'p1', owner), false, 'a free chat');
  assert.equal(viewBelongsToProject({ kind: 'diary' }, 'p1', owner), false);
  assert.equal(viewBelongsToProject({ kind: 'projects' }, 'p1', owner), false);
});

test('save and sync failures get their own translated messages', () => {
  const { projectSaveErrorText, projectSyncErrorText } = load();
  const tr = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`;
  assert.equal(projectSaveErrorText(new Error('config save failed: 500.'), tr), 'projectSave.failed{"reason":"config save failed: 500"}');
  assert.equal(projectSaveErrorText(new Error('413 Payload Too Large'), tr), 'projectSave.tooLarge');
  assert.equal(projectSaveErrorText('nope', tr), 'projectSave.failedGeneric');
  assert.equal(projectSyncErrorText(new Error('sync failed: 502'), tr), 'projectSave.syncFailed{"reason":"sync failed: 502"}');
  assert.equal(projectSyncErrorText(null, tr), 'projectSave.syncFailedGeneric');
});

test('App routes the delete and save errors through those helpers, with no hardcoded English', () => {
  const app = src('App.tsx');
  assert.doesNotMatch(app, /That did not save/);
  assert.match(app, /setProjectError\(tr\('projectDelete\.failed'\)\)/);
  assert.match(app, /setProjectError\(projectSyncErrorText\(e, tr\)\)/);
  assert.equal([...app.matchAll(/projectSaveErrorText\(e, tr\)/g)].length, 2, 'debounced patch and settings save');
  assert.doesNotMatch(app, /\.catch\(\(\) => undefined\);\n\s*\},\n\s*\[refreshProjects\]/, 'delete no longer swallows its error');
});

test('every new message key is present and non-empty in every locale, with matching placeholders', () => {
  const keys = ['projectDelete.failed', 'projectSave.failed', 'projectSave.failedGeneric', 'projectSave.tooLarge', 'projectSave.syncFailed', 'projectSave.syncFailedGeneric'];
  const dir = path.join(__dirname, '../../src/i18n');
  const locales = fs.readdirSync(dir).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts');
  assert.ok(locales.length >= 9, `found ${locales.join(', ')}`);
  const placeholders = (v) => (v.match(/\{\w+\}/g) || []).sort().join();
  const en = src('i18n/en-GB.ts');
  const value = (text, key) => { const m = text.match(new RegExp(`'${key.replace('.', '\\.')}': "((?:[^"\\\\]|\\\\.)*)"`)); return m && m[1]; };
  for (const f of locales) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const k of keys) {
      const v = value(text, k);
      assert.ok(v && v.trim(), `${f} is missing ${k}`);
      assert.equal(placeholders(v), placeholders(value(en, k)), `${f} ${k} placeholders`);
    }
  }
});
