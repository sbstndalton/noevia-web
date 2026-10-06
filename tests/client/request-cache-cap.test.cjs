'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withCache(fn) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try { return await fn(await server.ssrLoadModule('/src/request-cache.ts')); }
  finally { await server.close(); }
}

test('many one-off listing keys evict an old settled entry', () => withCache(async ({ cached }) => {
  let loads = 0;
  const load = () => { loads += 1; return Promise.resolve(loads); };
  assert.equal(await cached('diary:files:', load), 1);
  for (let i = 0; i < 129; i += 1) await cached(`diary:files:folder-${i}`, load);
  assert.equal(await cached('diary:files:', load), 131);
}));

test('a slow request stays shared past the TTL and starts its TTL when it resolves', () => withCache(async ({ cached }) => {
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    let resolve;
    let loads = 0;
    const first = cached('diary:files:slow', () => { loads += 1; return new Promise(done => { resolve = done; }); }, 10);
    now += 20; // Dispatch TTL elapsed, but the request is still in flight.
    const second = cached('diary:files:slow', () => { loads += 1; return Promise.resolve('duplicate'); }, 10);
    assert.equal(first, second);
    assert.equal(loads, 1);
    resolve('listing');
    assert.equal(await second, 'listing');
    assert.equal(await cached('diary:files:slow', () => { loads += 1; return Promise.resolve('duplicate'); }, 10), 'listing');
    assert.equal(loads, 1);
    now += 11; // The TTL now expires relative to completion, not dispatch.
    assert.equal(await cached('diary:files:slow', () => { loads += 1; return Promise.resolve('fresh'); }, 10), 'fresh');
    assert.equal(loads, 2);
  } finally { Date.now = originalNow; }
}));

test('capacity pressure preserves existing in-flight requests', () => withCache(async ({ cached }) => {
  const finish = [];
  const pending = Array.from({ length: 128 }, (_, i) => cached(`diary:files:folder-${i}`, () => new Promise(done => { finish.push(done); })));
  const overflow = cached('diary:files:overflow', () => Promise.resolve('overflow'));
  const firstAgain = cached('diary:files:folder-0', () => Promise.resolve('duplicate'));
  assert.equal(firstAgain, pending[0]);
  finish.forEach((done, i) => done(`folder-${i}`));
  assert.equal(await firstAgain, 'folder-0');
  assert.equal(await overflow, 'overflow');
  await Promise.all(pending);
}));
