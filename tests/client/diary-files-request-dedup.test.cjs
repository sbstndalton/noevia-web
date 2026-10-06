// #456: DiaryView's "overview" effect (building the Memory/Sources sidebar summary) and its
// separate "files" effect (populating the current folder listing) both land on `listFiles('')`
// for the Diary root on the same mount — neither effect knows the other already asked. The
// Playwright job (qa/dup-fetches-456-457-459.cjs) drives a real page load against a synthetic
// fixture and counts requests, the way the issue describes. This test exercises the same shared
// cache (`src/request-cache.ts`) the fix reuses, loading the real `src/diary-workspace.ts` module
// through Vite's SSR pipeline (same technique tests/client/profile-features-request-dedup.test.cjs uses)
// with a synthetic `fetch`, so the dedup/invalidation logic is covered by a fast Node test.
//
// No real Diary prompts or corpus are used anywhere here — every fixture below is synthetic.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withDiaryWorkspace(fn) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  const calls = [];
  const state = { rootFiles: [{ path: 'MEMORY.md', name: 'MEMORY.md', isDir: false }, { path: 'Raw Sources', name: 'Raw Sources', isDir: true }] };
  global.window = Object.assign(new EventTarget(), {});
  global.document = { cookie: '' };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    if (url === '/api/diary/files?path=' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ files: state.rootFiles }) };
    }
    if (url === '/api/diary/files?path=Raw%20Sources' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ files: [{ path: 'Raw Sources/source-1.md', name: 'source-1.md', isDir: false }] }) };
    }
    if (url === '/api/diary/file' && method === 'PUT') {
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ path: body.path, content: body.content, version: 'v2' }) };
    }
    throw new Error(`unexpected synthetic fetch: ${method} ${url}`);
  };
  try {
    const workspace = await server.ssrLoadModule('/src/diary-workspace.ts');
    return await fn({ workspace, calls, state });
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.fetch;
    await server.close();
  }
}

const count = (calls, needle) => calls.filter((c) => c === needle).length;

test('#456 the overview effect and the files effect both calling listFiles(\'\') on the same mount hit /api/diary/files?path= once', () => withDiaryWorkspace(async ({ workspace, calls }) => {
  const [overview, files] = await Promise.all([workspace.listFiles(''), workspace.listFiles('')]);
  assert.equal(count(calls, 'GET /api/diary/files?path='), 1, `expected exactly one request, saw: ${calls.join(', ')}`);
  assert.deepEqual(overview, files);
}));

test('#456 a later listFiles(\'\') within the TTL window is served from cache, not a second request', () => withDiaryWorkspace(async ({ workspace, calls }) => {
  await workspace.listFiles('');
  await workspace.listFiles('');
  assert.equal(count(calls, 'GET /api/diary/files?path='), 1);
}));

test('#456 different paths are cached independently (root vs a subfolder are not the same key)', () => withDiaryWorkspace(async ({ workspace, calls }) => {
  await workspace.listFiles('');
  await workspace.listFiles('Raw Sources');
  assert.equal(count(calls, 'GET /api/diary/files?path='), 1);
  assert.equal(count(calls, 'GET /api/diary/files?path=Raw%20Sources'), 1);
}));

test('#456 writeFile() invalidates the listing cache so a save is never followed by a stale root listing', () => withDiaryWorkspace(async ({ workspace, calls, state }) => {
  const before = await workspace.listFiles('');
  assert.equal(before.files.length, 2);
  state.rootFiles = [...state.rootFiles, { path: 'new-note.md', name: 'new-note.md', isDir: false }];
  await workspace.writeFile({ path: 'new-note.md', content: 'synthetic content', version: 'v1' });
  const after = await workspace.listFiles('');
  assert.equal(after.files.length, 3, 'listFiles(\'\') after a write must not replay the pre-write cached listing');
  assert.equal(count(calls, 'GET /api/diary/files?path='), 2, 'the write must force a fresh listing read');
}));

test('#456 a call carrying its own AbortSignal (folder search) bypasses the cache and is never shared', () => withDiaryWorkspace(async ({ workspace, calls }) => {
  const controller = new AbortController();
  await workspace.listFiles('', controller.signal);
  await workspace.listFiles('');
  assert.equal(count(calls, 'GET /api/diary/files?path='), 2, 'a signalled call must not populate or read the shared cache');
}));
