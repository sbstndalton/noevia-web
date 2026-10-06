// #458: on the /code route, CodingWorkspace and Sidebar each mount their own useCodeAccess(id)
// instance for the same computed project id, and each used to call fetchCode(projectId)
// independently — doubling every request in the probe sequence #450 documented (a placeholder-id
// 404 and a real-id 200, each x2). Same architectural gap as #422/#425 (fetchProfile/
// fetchFeatureFlags): apps/web/src/components/code/api.ts now exposes fetchCodeAccess(projectId),
// a thin cached() wrapper (request-cache.ts) around fetchCode, and useCodeAccess.ts's own effect
// calls that instead of fetchCode directly. This test exercises the same shared cache
// tests/client/profile-features-request-dedup.test.cjs uses for /api/profile and /api/features, loading
// the real src/components/code/api.ts through Vite's SSR pipeline with a synthetic fetch — no
// React, no browser (the end-to-end network-count proof against a real page load is
// qa/code-access-flash-450.cjs).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withCodeApi(fn) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  const calls = [];
  const state = { status: 200 };
  global.window = Object.assign(new EventTarget(), {});
  global.document = { cookie: '' };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(`GET ${url}`);
    if (url === '/api/projects/p1/code') {
      if (state.status !== 200) return { ok: false, status: state.status, json: async () => ({ error: 'forbidden' }) };
      return { ok: true, status: 200, json: async () => ({ repositories: [{ id: 'noevia' }], capabilities: [], defaultCapabilities: [], harnesses: [], promptPreparation: [], sandboxed: true, tasks: [] }) };
    }
    throw new Error(`unexpected synthetic fetch: GET ${url}`);
  };
  try {
    const codeApi = await server.ssrLoadModule('/src/components/code/api.ts');
    return await fn({ codeApi, calls, state });
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.fetch;
    await server.close();
  }
}

const count = (calls, needle) => calls.filter((c) => c === needle).length;

test('#458 CodingWorkspace + Sidebar both calling fetchCodeAccess(p1) concurrently hit /api/projects/p1/code once', () => withCodeApi(async ({ codeApi, calls }) => {
  const [a, b] = await Promise.all([codeApi.fetchCodeAccess('p1'), codeApi.fetchCodeAccess('p1')]);
  assert.equal(count(calls, 'GET /api/projects/p1/code'), 1, `expected exactly one request, saw: ${calls.join(', ')}`);
  assert.deepEqual(a, b);
}));

test('#458 a later fetchCodeAccess(p1) within the TTL window is served from cache, not a second request', () => withCodeApi(async ({ codeApi, calls }) => {
  await codeApi.fetchCodeAccess('p1');
  await codeApi.fetchCodeAccess('p1');
  assert.equal(count(calls, 'GET /api/projects/p1/code'), 1);
}));

test('#458 fetchCodeAccess for a different id is its own request, never served the other id\'s cached answer', () => withCodeApi(async ({ codeApi, calls }) => {
  global.fetch = async (input) => { calls.push(`GET ${input}`); return { ok: true, status: 200, json: async () => ({ repositories: [], capabilities: [], defaultCapabilities: [], harnesses: [], promptPreparation: [], sandboxed: true, tasks: [] }) }; };
  await codeApi.fetchCodeAccess('p1');
  await codeApi.fetchCodeAccess('p2');
  assert.equal(count(calls, 'GET /api/projects/p1/code'), 1);
  assert.equal(count(calls, 'GET /api/projects/p2/code'), 1);
}));

test('#458 a denied (non-2xx) probe does not poison the cache for the rest of the TTL window', () => withCodeApi(async ({ codeApi, state }) => {
  state.status = 403;
  await assert.rejects(() => codeApi.fetchCodeAccess('p1'));
  state.status = 200;
  const recovered = await codeApi.fetchCodeAccess('p1');
  assert.ok(recovered.repositories, 'a retry right after a denied probe must not keep replaying the rejection');
}));

test('#458 fetchCode itself (CodePanel\'s live task polling) stays uncached — every call is a fresh request', () => withCodeApi(async ({ codeApi, calls }) => {
  await codeApi.fetchCode('p1');
  await codeApi.fetchCode('p1');
  assert.equal(count(calls, 'GET /api/projects/p1/code'), 2, 'fetchCode must not be deduped — CodePanel polls it for live task status');
}));
