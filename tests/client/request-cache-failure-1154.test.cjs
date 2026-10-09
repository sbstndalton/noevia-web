'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withCache(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try { return await fn(await server.ssrLoadModule('/src/request-cache.ts')); }
  finally { await server.close(); }
}

test('#1154: with a failure window, a second reader shares the failed read; without one it retries', () => withCache(async ({ cached, invalidateCached }) => {
  let loads = 0;
  const failing = () => { loads += 1; return Promise.reject(new Error('424')); };
  await assert.rejects(cached('k1', failing, 4000, 1500));
  await assert.rejects(cached('k1', failing, 4000, 1500));
  assert.equal(loads, 1, 'the second reader reuses the failure');
  invalidateCached('k1');
  await assert.rejects(cached('k1', failing, 4000, 1500));
  assert.equal(loads, 2, 'an explicit invalidation still retries');
  loads = 0;
  await assert.rejects(cached('k2', failing));
  await assert.rejects(cached('k2', failing));
  assert.equal(loads, 2, 'the default keeps the retry-immediately behaviour');
}));

test('#1154: a failure window expires', () => withCache(async ({ cached }) => {
  const originalNow = Date.now;
  let now = 1000; Date.now = () => now;
  try {
    let loads = 0;
    const failing = () => { loads += 1; return Promise.reject(new Error('424')); };
    await assert.rejects(cached('k3', failing, 4000, 1500));
    now += 1600;
    await assert.rejects(cached('k3', failing, 4000, 1500));
    assert.equal(loads, 2);
  } finally { Date.now = originalNow; }
}));
