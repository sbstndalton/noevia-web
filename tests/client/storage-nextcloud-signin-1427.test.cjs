'use strict';
// #1427: Nextcloud sign-in in Settings → Diary & storage. The sign-in address is the server root
// even when the saved connection is a WebDAV URL (live: an internal http:// address, which made
// the old button answer "HTTPS Nextcloud URL required"), and the "not approved yet" 202 from the
// poll is a pending answer, not a source job (postJson used to chase an undefined `poll` URL).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withModules(names, fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  const saved = { window: global.window, document: global.document, fetch: global.fetch };
  global.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  global.document = { cookie: '', documentElement: { dataset: {}, lang: '' } };
  try {
    const mods = [];
    for (const name of names) mods.push(await server.ssrLoadModule(name));
    return await fn(...mods);
  } finally {
    global.window = saved.window; global.document = saved.document; global.fetch = saved.fetch;
    await server.close();
  }
}

test('the sign-in address is the https server root of whatever was saved', () => withModules(['/src/components/StoragePicker.tsx'], ({ nextcloudSignInAddress, looksLikeNextcloud }) => {
  assert.equal(nextcloudSignInAddress('https://drive.example.test/remote.php/dav/files/Ada%20L'), 'https://drive.example.test');
  assert.equal(nextcloudSignInAddress('https://drive.example.test/nc/index.php/apps/files/?dir=/'), 'https://drive.example.test/nc');
  assert.equal(nextcloudSignInAddress('https://drive.example.test/'), 'https://drive.example.test');
  assert.equal(nextcloudSignInAddress('http://10.0.0.5:11000/remote.php/dav/files/ada'), '', 'an internal http WebDAV address is not offered for sign-in');
  assert.equal(nextcloudSignInAddress(''), '');
  assert.equal(looksLikeNextcloud('http://10.0.0.5:11000/remote.php/dav/files/ada'), true);
  assert.equal(looksLikeNextcloud('https://dav.example.test/remote.php/webdav/'), true);
  assert.equal(looksLikeNextcloud('https://dav.example.test/dav/'), false);
}));

test('the poll treats 202 as pending and keeps the error code, reason and wait', () => withModules(['/src/api.ts'], async ({ pollNextcloud, startNextcloud }) => {
  const calls = [];
  let reply;
  global.fetch = async (url, init) => { calls.push([String(url), init]); return reply(); };
  reply = () => new Response(JSON.stringify({ pending: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await pollNextcloud('flow-1', ''), { pending: true });
  assert.equal(calls.length, 1, 'no follow-up request to a source-job poll URL');
  assert.deepEqual(JSON.parse(calls[0][1].body), { flowId: 'flow-1', corpusRoot: '' });
  reply = () => new Response(JSON.stringify({ error: 'Nextcloud at drive.example.test is throttling sign-ins', code: 'nextcloudThrottled', retryAfter: 120 }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(pollNextcloud('flow-1', ''), (e) => e.code === 'nextcloudThrottled' && e.retryAfter === 120);
  reply = () => new Response(JSON.stringify({ error: 'Nextcloud at drive.example.test did not answer within 10 seconds.', code: 'nextcloudUnreachable', reason: 'timeout' }), { status: 504, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(startNextcloud('https://drive.example.test'), (e) => e.code === 'nextcloudUnreachable' && e.reason === 'timeout' && !/^Error:/.test(e.message));
}));

test('#1433: cancel tells the server which flow to end', () => withModules(['/src/api.ts'], async ({ cancelNextcloud }) => {
  const calls = [];
  global.fetch = async (url, init) => { calls.push([String(url), init]); return new Response(JSON.stringify({ cancelled: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  assert.deepEqual(await cancelNextcloud('flow-9'), { cancelled: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/integrations/storage/nextcloud/cancel');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { flowId: 'flow-9' });
}));
