// #1033: the client tests' Vite servers must not start a port, a watcher or a dependency scan
// (see vite-ssr-server.cjs), and a stuck file must fail instead of stalling the image build.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createServer, hermeticOptions } = require('./vite-ssr-server.cjs');

const ROOT = path.resolve(__dirname, '../..');
const HELPER = path.join(__dirname, 'vite-ssr-server.cjs');

test('#1033 no client test starts Vite directly; every one goes through vite-ssr-server.cjs', () => {
  const direct = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.cjs') && f !== 'vite-ssr-server.cjs')
    .filter((f) => /import\(\s*['"]vite['"]\s*\)|require\(\s*['"]vite['"]\s*\)/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.deepEqual(direct, [], `start the server with require('./vite-ssr-server.cjs').createServer instead: ${direct.join(', ')}`);
});

test('#1033 the hermetic options win over a test\'s own and keep everything else', () => {
  const plugin = { name: 'synthetic' };
  const o = hermeticOptions({ root: ROOT, appType: 'custom', plugins: [plugin], server: { middlewareMode: false, hmr: true, fs: { strict: false } }, optimizeDeps: { include: ['x'], exclude: ['y'] } });
  assert.equal(o.root, ROOT); assert.equal(o.appType, 'custom'); assert.deepEqual(o.plugins, [plugin]);
  assert.deepEqual(o.server, { middlewareMode: true, hmr: false, ws: false, watch: null, fs: { strict: false } });
  assert.deepEqual(o.optimizeDeps, { include: [], exclude: ['y'], noDiscovery: true });
});

test('#1033 a test server has no WebSocket, no watcher and no dependency scan, and closes at once, repeatedly', async () => {
  // profile-features-request-dedup.test.cjs starts and closes seven servers back to back; do the same.
  for (let i = 0; i < 7; i++) {
    const server = await createServer({ configFile: false, root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    try {
      assert.equal(server.config.server.ws, false);
      assert.equal(server.config.server.hmr, false);
      assert.equal(server.config.server.watch, null);
      assert.equal(server.environments.client.depsOptimizer, undefined, 'the client dependency scan must be off');
      const mod = await server.ssrLoadModule('/src/request-cache.ts');
      assert.equal(typeof mod.cached, 'function');
    } finally {
      let timer;
      await Promise.race([
        server.close(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`server ${i} did not close within 10 s`)), 10000); }),
      ]).finally(() => clearTimeout(timer));
    }
  }
});

test('#1033 the watchdog fails a stuck file with a reason, and never delays a healthy one', () => {
  const stuck = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(HELPER)}).armWatchdog(); setInterval(() => {}, 1000);`],
    { env: { ...process.env, CLIENT_TEST_FILE_TIMEOUT_MS: '300' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(stuck.status, 1, `expected exit 1, got ${stuck.status} (${stuck.signal || 'no signal'})`);
  assert.match(stuck.stderr, /\[#1033\] .* is still running after 300 ms; failing instead of hanging\. Active resources: .*Timeout/);

  const started = Date.now();
  const healthy = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(HELPER)}).armWatchdog(); setTimeout(() => {}, 50);`],
    { env: { ...process.env, CLIENT_TEST_FILE_TIMEOUT_MS: '60000' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.ok(Date.now() - started < 15000, 'an unref\'d watchdog must not keep a finished file alive');
});
