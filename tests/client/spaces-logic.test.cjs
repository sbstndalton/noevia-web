'use strict';
// sbstndalton/noevia#2446: the pure parts of the Spaces area: limits, the capability gate, local drafts, the paths.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./spaces-load.cjs');
const plain = (o) => JSON.parse(JSON.stringify(o));

const limits = load('spaces-limits.ts');
test('search: blank sends nothing, 200 characters is allowed, 201 is refused before any request', () => {
  assert.equal(limits.searchQuery('   ').kind, 'none');
  assert.deepEqual(plain(limits.searchQuery('x'.repeat(200))), { kind: 'ok', q: 'x'.repeat(200) });
  assert.deepEqual(plain(limits.searchQuery('x'.repeat(201))), { kind: 'too-long', length: 201 });
  assert.equal(limits.searchQuery('  hello  ').q, 'hello');
});
test('search counts characters, not UTF-16 units', () => {
  assert.equal(limits.searchQuery('😀'.repeat(200)).kind, 'ok');
  assert.equal(limits.searchQuery('😀'.repeat(201)).kind, 'too-long');
});
test('draft limits: title 1 to 200, content at most 512 KiB in bytes', () => {
  assert.equal(limits.draftProblem({ title: 'ok', content: '' }), null);
  assert.equal(limits.draftProblem({ title: '  ', content: '' }), 'title-empty');
  assert.equal(limits.draftProblem({ title: 't'.repeat(201), content: '' }), 'title-long');
  assert.equal(limits.draftProblem({ title: 't'.repeat(200), content: '' }), null);
  assert.equal(limits.draftProblem({ title: 'ok', content: 'a'.repeat(512 * 1024) }), null);
  assert.equal(limits.draftProblem({ title: 'ok', content: 'a'.repeat(512 * 1024 + 1) }), 'too-large');
  assert.equal(limits.draftProblem({ title: 'ok', content: 'é'.repeat(262145) }), 'too-large', 'bytes, not characters');
});

const gate = load('area-gate.ts');
const answer = (status, body, bad) => async () => ({ status, json: async () => { if (bad) throw new Error('not json'); return body; } });
test('the area is available only on a 200 list', async () => {
  assert.equal(await gate.areaAvailable(answer(200, { revision: 1, spaces: [] }), '/api/spaces', 'spaces'), true);
  assert.equal(await gate.areaAvailable(answer(200, { specialists: [] }), '/api/specialists', 'specialists'), true);
});
test('absent on 404, other failures, a network error, and a 200 that is not the list', async () => {
  for (const status of [404, 401, 403, 500, 502]) assert.equal(await gate.areaAvailable(answer(status, { spaces: [] }), '/api/spaces', 'spaces'), false, String(status));
  assert.equal(await gate.areaAvailable(async () => { throw new Error('offline'); }, '/api/spaces', 'spaces'), false);
  assert.equal(await gate.areaAvailable(answer(200, null, true), '/api/spaces', 'spaces'), false, 'the app shell answering every path');
  assert.equal(await gate.areaAvailable(answer(200, { spaces: 'x' }), '/api/spaces', 'spaces'), false);
  assert.equal(await gate.areaAvailable(answer(200, null), '/api/spaces', 'spaces'), false);
});

const drafts = load('page-drafts.ts');
function memory() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); }, m }; }
test('a device draft round-trips per page and is cleared on request', () => {
  const store = memory();
  assert.equal(drafts.writePageDraft('s1', 'p1', { title: 'T', content: 'C', baseVersion: 'v1', savedAt: 5 }, store), true);
  assert.deepEqual(plain(drafts.readPageDraft('s1', 'p1', store)), { title: 'T', content: 'C', baseVersion: 'v1', savedAt: 5 });
  assert.equal(drafts.readPageDraft('s1', 'p2', store), null);
  drafts.clearPageDraft('s1', 'p1', store);
  assert.equal(drafts.readPageDraft('s1', 'p1', store), null);
});
test('corrupt, wrong-shaped and unavailable storage read as no draft and never throw', () => {
  const store = memory();
  store.setItem('noevia:space-page-draft:s:p', '{nope');
  assert.equal(drafts.readPageDraft('s', 'p', store), null);
  store.setItem('noevia:space-page-draft:s:p', JSON.stringify({ title: 1 }));
  assert.equal(drafts.readPageDraft('s', 'p', store), null);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(drafts.readPageDraft('s', 'p', broken), null);
  assert.equal(drafts.writePageDraft('s', 'p', { title: 'a', content: 'b', baseVersion: null, savedAt: 1 }, broken), false);
  drafts.clearPageDraft('s', 'p', broken);
  assert.equal(drafts.writePageDraft('s', 'p', { title: 'a', content: 'b', baseVersion: null, savedAt: 1 }, null), false);
});

const routes = load('routes.ts');
test('the Spaces paths parse and round-trip', () => {
  const id = '3f2b8c1e-0d4a-4c5e-9a77-1b2c3d4e5f60', pid = '9a8b7c6d-1111-4222-8333-444455556666';
  assert.deepEqual(plain(routes.matchPath('/spaces')), { kind: 'spaces' });
  assert.deepEqual(plain(routes.matchPath(`/spaces/${id}`)), { kind: 'spaces', spaceId: id });
  assert.deepEqual(plain(routes.matchPath(`/spaces/${id}/${pid}`)), { kind: 'spaces', spaceId: id, pageId: pid });
  for (const r of ['/spaces', `/spaces/${id}`, `/spaces/${id}/${pid}`]) assert.equal(routes.toPath(routes.matchPath(r)), r);
  assert.equal(routes.matchPath(`/spaces/${id}/${pid}/x`), null);
  assert.equal(routes.matchPath('/spaces/bad id'), null);
  assert.equal(routes.matchPath('/spaces/..%2Fx'), null);
});
test('the Spaces view is the address; a page needs its Space', () => {
  const nav = (view) => ({ view, settingsOpen: false, settingsSection: 'appearance', codeMode: false });
  assert.deepEqual(plain(routes.routeForState(nav({ kind: 'spaces' }))), { kind: 'spaces' });
  assert.deepEqual(plain(routes.routeForState(nav({ kind: 'spaces', spaceId: 's-1' }))), { kind: 'spaces', spaceId: 's-1' });
  assert.deepEqual(plain(routes.routeForState(nav({ kind: 'spaces', spaceId: 's-1', pageId: 'p-1' }))), { kind: 'spaces', spaceId: 's-1', pageId: 'p-1' });
  assert.deepEqual(plain(routes.routeForState(nav({ kind: 'spaces', pageId: 'p-1' }))), { kind: 'spaces' });
});
test('a signed-in return path to a Space survives, junk does not', () => {
  assert.equal(routes.safeReturnPath('/spaces/abc-1'), '/spaces/abc-1');
  assert.equal(routes.safeReturnPath('/spaces/a/b/c'), '/');
});

const fmt = load('spaces-format.ts');
test('relative times follow the locale and accept seconds or milliseconds', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);
  assert.equal(fmt.relativeTime(now - 3 * 3600 * 1000, 'en-GB', now), '3 hours ago');
  assert.equal(fmt.relativeTime((now - 3 * 3600 * 1000) / 1000, 'en-GB', now), '3 hours ago');
  assert.match(fmt.relativeTime(now - 2 * 86400 * 1000, 'de-DE', now), /vorgestern/);
  assert.equal(fmt.pageName('  ', 'Untitled'), 'Untitled');
});

test('the Coworkers paths parse, round-trip, and a coworker conversation keeps its own address', () => {
  const id = '3f2b8c1e-0d4a-4c5e-9a77-1b2c3d4e5f60';
  assert.deepEqual(plain(routes.matchPath('/coworkers')), { kind: 'coworkers' });
  assert.deepEqual(plain(routes.matchPath(`/coworkers/${id}`)), { kind: 'coworkers', id });
  for (const r of ['/coworkers', `/coworkers/${id}`]) assert.equal(routes.toPath(routes.matchPath(r)), r);
  assert.equal(routes.matchPath(`/coworkers/${id}/x`), null);
  assert.equal(routes.matchPath('/coworkers/a b'), null);
  const nav = (view) => ({ view, settingsOpen: false, settingsSection: 'appearance', codeMode: false });
  assert.deepEqual(plain(routes.routeForState(nav({ kind: 'chat', chatId: 'chat-1', projectId: 'specialist-1', coworkerId: id }))), { kind: 'coworkers', id });
  assert.deepEqual(plain(routes.routeForState(nav({ kind: 'chat', chatId: 'chat-1', projectId: null }))), { kind: 'chat', chatId: 'chat-1' });
  assert.deepEqual(plain(routes.routeForState(nav({ kind: 'coworkers', id }))), { kind: 'coworkers', id });
});
