'use strict';
// #1509 / #1461: the installed-model list, the auto-role config and the effort settings are shared
// while in flight and for a short TTL, and a successful write drops them. These tests load the real
// src/api.ts through Vite's SSR pipeline with a counting fake fetch, so they fail if a second view
// asks the server again, or if a save leaves a stale answer behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withApi(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  // api.ts reads the CSRF cookie from document on every request; there is no browser here.
  const hadDocument = 'document' in globalThis;
  if (!hadDocument) globalThis.document = { cookie: '' };
  const calls = [];
  let respond = () => ({ status: 200, body: {} });
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url, method });
    const { status, body } = respond(url, method);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const api = await server.ssrLoadModule('/src/api.ts');
    const reads = await server.ssrLoadModule('/src/model-reads.ts');
    return await fn({ api, reads, calls, setResponder: (fn2) => { respond = fn2; } });
  } finally {
    globalThis.fetch = originalFetch;
    if (!hadDocument) delete globalThis.document;
    await server.close();
  }
}

const count = (calls, url, method = 'GET') => calls.filter(c => c.url === url && c.method === method).length;

test('concurrent mounts of the installed-model list share one request', () => withApi(async ({ api, calls, setResponder }) => {
  setResponder(() => ({ status: 200, body: [{ name: 'm1', labels: [] }] }));
  const [a, b, c] = await Promise.all([api.fetchInstalledModels(), api.fetchInstalledModels(), api.fetchInstalledModels()]);
  assert.equal(count(calls, '/api/models/installed'), 1);
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  assert.equal(a[0].name, 'm1');
}));

test('auto-roles are shared while in flight, then re-read after a save', () => withApi(async ({ api, calls, setResponder }) => {
  setResponder((url, method) => (method === 'PUT' ? { status: 200, body: { configured: true } } : { status: 200, body: { configured: false, roles: null } }));
  await Promise.all([api.fetchAutoRoles(), api.fetchAutoRoles(), api.fetchAutoRoles(), api.fetchAutoRoles()]);
  assert.equal(count(calls, '/api/auto-roles'), 1, 'four Models-tab reads cost one request');
  await api.setAutoRoles({ fast: 'a', smart: 'b' });
  await api.fetchAutoRoles();
  assert.equal(count(calls, '/api/auto-roles'), 2, 'a save drops the shared answer so the next read is fresh');
}));

test('a failed read is not kept: the next caller retries', () => withApi(async ({ api, calls, setResponder }) => {
  let fail = true;
  setResponder(() => (fail ? { status: 500, body: { error: 'down' } } : { status: 200, body: [] }));
  await assert.rejects(api.fetchInstalledModels());
  fail = false;
  assert.deepEqual(await api.fetchInstalledModels(), []);
  assert.equal(count(calls, '/api/models/installed'), 2);
}));

test('a model write through apiFetch drops the shared model reads', () => withApi(async ({ api, reads, calls, setResponder }) => {
  setResponder(() => ({ status: 200, body: [] }));
  await api.fetchInstalledModels();
  await api.apiFetch('/api/models/load', { method: 'POST', body: '{}' });
  await api.fetchInstalledModels();
  assert.equal(count(calls, '/api/models/installed'), 2);
  assert.equal(reads.isModelWritePath('/api/chat'), false, 'an ordinary chat write leaves the model reads alone');
}));

test('effort settings are shared per project and dropped by a save', () => withApi(async ({ api, calls, setResponder }) => {
  setResponder((url, method) => (method === 'GET' ? { status: 200, body: { default: 'default', effort: 'default', mode: 'real', admin: false } } : { status: 200, body: { ok: true } }));
  await Promise.all([api.fetchReasoningSettings('p1'), api.fetchReasoningSettings('p1')]);
  await api.fetchReasoningSettings(null);
  assert.equal(count(calls, '/api/reasoning-settings?projectId=p1'), 1);
  assert.equal(count(calls, '/api/reasoning-settings'), 1);
  await api.apiFetch('/api/projects/p1/config', { method: 'POST', body: '{}' });
  await api.fetchReasoningSettings('p1');
  assert.equal(count(calls, '/api/reasoning-settings?projectId=p1'), 2, 'a project config save drops its effort settings');
}));

test('model-read path matchers cover the model and effort write paths only', () => withApi(async ({ reads }) => {
  for (const p of ['/api/models/load', '/api/model-manager/models/delete', '/api/auto-roles', '/api/routing-default']) assert.equal(reads.isModelWritePath(p), true, p);
  for (const p of ['/api/chat', '/api/modelsx', '/api/chats/c1/history']) assert.equal(reads.isModelWritePath(p), false, p);
  assert.equal(reads.isReasoningWritePath('/api/reasoning-settings'), true);
  assert.equal(reads.isReasoningWritePath('/api/projects/p1/config'), true);
  assert.equal(reads.isReasoningWritePath('/api/projects/p1/chats'), false);
}));
