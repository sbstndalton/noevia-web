// #459: `App`'s `refreshProjects()` fetches `/api/workspace` on its own mount, and
// `ArchivedChatsView`/`useArchivedCount` (components/data/ArchivedChats.tsx) each independently
// fetch it again on their own mount — neither reuses the copy `App` already fetched. Every other
// view fetches `/api/workspace` exactly once because only `App` reads it there.
//
// The Playwright job (qa/dup-fetches-456-457-459.cjs) drives a real page load against a synthetic
// fixture and counts requests, the way the issue describes. This test exercises the same shared
// cache (`src/request-cache.ts`) that fix depends on, loading the real `src/api.ts` and
// `src/components/data/workspace-changed.ts` modules through Vite's SSR pipeline (same technique
// tests/client/profile-features-request-dedup.test.cjs uses) with a synthetic `fetch`, so the
// dedup/invalidation logic itself is covered by a fast Node test.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function makeWorkspace(overrides = {}) {
  return {
    projects: [{ id: 'p1', name: 'Synthetic project', chats: [{ id: 'c1', title: 'Chat one', updatedAt: 1, archived: false }] }],
    freeChats: [{ id: 'f1', title: 'Free chat one', updatedAt: 2, archived: true }],
    ...overrides,
  };
}

async function withWorkspaceModules(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  const calls = [];
  const state = { workspace: makeWorkspace() };
  global.window = Object.assign(new EventTarget(), {});
  global.document = { cookie: '' };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    if (url === '/api/workspace' && method === 'GET') {
      return { ok: true, status: 200, json: async () => state.workspace };
    }
    if (url === '/api/projects/p1/sources/sync?background=1') return { ok: true, status: 202, json: async () => ({ poll: '/api/source-job' }) };
    if (url === '/api/source-job') return { ok: true, status: 200, json: async () => ({ done: true, status: 200, body: { files: [] } }) };
    if (method !== 'GET') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url === '/api/expired') return { ok: false, status: 401 };
    throw new Error(`unexpected synthetic fetch: ${method} ${url}`);
  };
  try {
    const api = await server.ssrLoadModule('/src/api.ts');
    const workspaceChanged = await server.ssrLoadModule('/src/components/data/workspace-changed.ts');
    return await fn({ api, workspaceChanged, calls, state });
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.fetch;
    await server.close();
  }
}

const count = (calls, needle) => calls.filter((c) => c === needle).length;

test('#459 App and ArchivedChatsView mounting together and each calling fetchWorkspace() hit /api/workspace once', () => withWorkspaceModules(async ({ api, calls }) => {
  // App.tsx's refreshProjects() and ArchivedChats.tsx's ArchivedChatsView/useArchivedCount each
  // call fetchWorkspace() from their own mount effect — simulated here as concurrent callers.
  const [a, b, c] = await Promise.all([api.fetchWorkspace(), api.fetchWorkspace(), api.fetchWorkspace()]);
  assert.equal(count(calls, 'GET /api/workspace'), 1, `expected exactly one /api/workspace request, saw: ${calls.join(', ')}`);
  assert.deepEqual(a, b); assert.deepEqual(b, c);
}));

test('#459 a later fetchWorkspace() within the TTL window is served from cache, not a second request', () => withWorkspaceModules(async ({ api, calls }) => {
  await api.fetchWorkspace();
  await api.fetchWorkspace();
  assert.equal(count(calls, 'GET /api/workspace'), 1);
}));

test('#459 notifyWorkspaceChanged() invalidates the cache so a mutation is never served the stale list (archive/restore)', () => withWorkspaceModules(async ({ api, workspaceChanged, calls, state }) => {
  const before = await api.fetchWorkspace();
  assert.equal(before.freeChats[0].archived, true);
  // Simulate ArchivedChatsView restoring a chat: the server-side workspace changes, then the
  // mutating code calls notifyWorkspaceChanged() the same way ArchivedChats.tsx's restore()/
  // remove() and Sidebar.tsx's archiveChat() do.
  state.workspace = makeWorkspace({ freeChats: [{ id: 'f1', title: 'Free chat one', updatedAt: 3, archived: false }] });
  workspaceChanged.notifyWorkspaceChanged();
  const after = await api.fetchWorkspace();
  assert.equal(after.freeChats[0].archived, false, 'fetchWorkspace() after a restore must not replay the pre-restore cached value');
  assert.equal(count(calls, 'GET /api/workspace'), 2, 'the workspace-changed event must force a fresh read');
}));

test('#459 useWorkspaceChanged listeners still fire on notifyWorkspaceChanged() (unrelated to the cache)', () => withWorkspaceModules(async ({ workspaceChanged }) => {
  let seen = 0;
  global.window.addEventListener(workspaceChanged.WORKSPACE_CHANGED, () => { seen += 1; });
  workspaceChanged.notifyWorkspaceChanged();
  assert.equal(seen, 1);
}));

for (const [name, mutate] of [
  ['create project', api => api.createProject({ name: 'Synthetic new project' })],
  ['delete project', api => api.deleteProject('p1')],
  ['project config', api => api.saveProjectConfig('p1', { name: 'Synthetic renamed project' })],
  ['archive free chat', api => api.saveFreeChats([])],
  ['restore project chat', api => api.saveProjectChats('p1', [])],
  ['logout', api => api.logout()],
  ['expired session', api => api.apiFetch('/api/expired')],
]) {
  test(`#459 ${name} invalidates without relying on a component notification`, () => withWorkspaceModules(async ({ api, calls, state }) => {
    await api.fetchWorkspace();
    await mutate(api);
    state.workspace = makeWorkspace({ projects: [], freeChats: [] });
    const after = await api.fetchWorkspace();
    assert.equal(after.projects.length, 0);
    assert.equal(count(calls, 'GET /api/workspace'), 2);
  }));
}

test('#459 a completed background source job invalidates a workspace fetched while it was pending', () => withWorkspaceModules(async ({ api, calls, state }) => {
  await api.fetchWorkspace();
  const sync = api.syncProjectSources('p1');
  await new Promise(resolve => setTimeout(resolve, 10));
  await api.fetchWorkspace(); // another mounted reader while the source job is pending
  state.workspace = makeWorkspace({ projects: [], freeChats: [] });
  await sync;
  const after = await api.fetchWorkspace();
  assert.equal(after.projects.length, 0);
  assert.equal(count(calls, 'GET /api/workspace'), 3);
}));
