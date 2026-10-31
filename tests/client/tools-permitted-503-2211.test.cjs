'use strict';
// #2211: GET /api/toolboxes/permitted answers 503 + Retry-After when the tool list is not ready (noevia-rs toolbox_routes.rs).
// fetchPermittedTools must say so with a typed error carrying the wait (capped like the history save), so the catalogue can retry
// instead of treating it as a hard failure; every other failure stays a plain Error. The browser behaviour (calm status, one retry,
// tools appear, no alert) is qa/tool-catalogue-preparing-2211.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withApi(respond, fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  const hadDocument = 'document' in globalThis;
  if (!hadDocument) globalThis.document = { cookie: '' };
  const urls = [];
  globalThis.fetch = async (input) => { urls.push(typeof input === 'string' ? input : input.url); return respond(); };
  try { return await fn(await server.ssrLoadModule('/src/api.ts'), urls); }
  finally { globalThis.fetch = originalFetch; if (!hadDocument) delete globalThis.document; await server.close(); }
}
const PREPARING = (retryAfter) => new Response(JSON.stringify({ error: 'The tool list is being prepared. Try again in a moment.' }), { status: 503, headers: { 'Content-Type': 'application/json', ...(retryAfter === null ? {} : { 'Retry-After': retryAfter }) } });

test('a 503 with Retry-After is a ToolsPreparingError that carries the wait', () => withApi(() => PREPARING('2'), async (api, urls) => {
  await assert.rejects(api.fetchPermittedTools('p1', 'chat'), (e) => e instanceof api.ToolsPreparingError && e.retryAfterMs === 2000 && /being prepared/.test(e.message));
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^\/api\/toolboxes\/permitted\?mode=chat&projectId=p1$/);
}));

test('the wait is capped, and 1 s when Retry-After is missing or not a number', async () => {
  await withApi(() => PREPARING('3600'), async (api) => assert.rejects(api.fetchPermittedTools(null, 'chat'), (e) => e.retryAfterMs === api.HISTORY_SAVE_RETRY_CAP_MS));
  await withApi(() => PREPARING(null), async (api) => assert.rejects(api.fetchPermittedTools(null, 'chat'), (e) => e instanceof api.ToolsPreparingError && e.retryAfterMs === 1000));
  await withApi(() => PREPARING('soon'), async (api) => assert.rejects(api.fetchPermittedTools(null, 'chat'), (e) => e.retryAfterMs === 1000));
});

test('other failures stay plain errors, and a 200 still returns the boxes', async () => {
  await withApi(() => new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }), async (api) => assert.rejects(api.fetchPermittedTools(null, 'chat'), (e) => !(e instanceof api.ToolsPreparingError) && e.message === 'Server error'));
  await withApi(() => new Response(JSON.stringify({ mode: 'chat', boxes: [] }), { status: 200 }), async (api) => assert.deepEqual(await api.fetchPermittedTools(null, 'chat'), { mode: 'chat', boxes: [] }));
});
