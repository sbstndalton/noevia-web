'use strict';
// #1643: sign-out and sign-in as someone else in ANOTHER tab leaves this tab holding the first
// account's in-memory state while its requests go out under the new account's cookie. The tab must
// notice (a marker in the localStorage every tab shares, or the server naming a different account
// when the tab is looked at again), stop sending and writing at once, and reload.
//
// Two tabs here are two Vite SSR servers (two copies of every module, so two separate in-memory
// states) over ONE localStorage and ONE fetch, the way two tabs of a browser share a cookie jar.
// The real src/api.ts, account-session.ts, account-device-state.ts and chat-drafts.ts run; only the
// browser globals and the network are fakes. Synthetic accounts only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    peek: (k) => (store.has(k) ? store.get(k) : null),
  };
}

function fakeWindow() {
  const window = new EventTarget();
  window.reloads = 0;
  window.events = [];
  window.location = { reload() { window.reloads += 1; } };
  const dispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = (e) => { window.events.push(e.type); return dispatch(e); };
  const document = new EventTarget();
  document.cookie = '';
  document.visibilityState = 'visible';
  return { window, document };
}

async function twoTabs(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const make = () => createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom' });
  const [serverA, serverB] = await Promise.all([make(), make()]);
  const saved = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  const storage = fakeLocalStorage();
  const sent = [];
  const session = { user: null, probeStatus: null };
  globalThis.localStorage = storage;
  globalThis.sessionStorage = { removeItem() {}, getItem: () => null, setItem() {} };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/auth/session') {
      if (session.probeStatus === 401 || !session.user) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ user: { id: session.user } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    sent.push({ url, method: (init.method || 'GET').toUpperCase(), body: init.body ? String(init.body) : '' });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const tabs = {};
  for (const [name, server] of [['a', serverA], ['b', serverB]]) {
    const env = fakeWindow();
    globalThis.window = env.window; globalThis.document = env.document;
    const load = (p) => server.ssrLoadModule(p);
    tabs[name] = {
      env,
      api: await load('/src/api.ts'),
      sessionMod: await load('/src/account-session.ts'),
      device: await load('/src/account-device-state.ts'),
      drafts: await load('/src/chat-drafts.ts'),
      cache: await load('/src/request-cache.ts'),
      // Run code "inside" a tab: the module under test reads window/document at call time.
      in(run) { globalThis.window = env.window; globalThis.document = env.document; return run(); },
    };
  }
  try {
    return await fn({ tabs, storage, sent, session, storageEvent: (tab) => tab.in(() => { const e = new Event('storage'); e.key = 'noevia:session-account'; tab.env.window.dispatchEvent(e); }) });
  } finally {
    Object.assign(globalThis, saved);
    for (const k of ['fetch', 'window', 'document', 'localStorage', 'sessionStorage']) if (saved[k] === undefined) delete globalThis[k];
    await Promise.all([serverA.close(), serverB.close()]);
  }
}

test('another tab signing in as a different user stops this tab: nothing sent, no draft written, state dropped, reloaded', () => twoTabs(async ({ tabs, storage, sent, storageEvent }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  a.in(() => a.drafts.writeDraft('chat-of-a', 'SYNTHETIC unsent text typed under account A'));
  let cacheLoads = 0;
  a.in(() => a.cache.cached('k', async () => { cacheLoads += 1; return 1; }));
  assert.equal(cacheLoads, 1);

  // Tab B: user A signs out and user B signs in (sign-out clears the device, sign-in claims it).
  b.in(() => { b.device.clearDeviceState(); b.device.claimDeviceState('user-b'); });
  assert.equal(storage.peek('noevia:session-account'), 'user-b');
  assert.equal(storage.peek('noevia:chat-drafts'), null, 'B\'s sign-in dropped A\'s drafts');

  // Before the storage event is even delivered, the guard is synchronous: A sends nothing under B's cookie.
  await a.in(() => assert.rejects(a.api.apiFetch('/api/chat', { method: 'POST', body: JSON.stringify({ text: 'SYNTHETIC unsent text typed under account A' }) }), (e) => e.name === 'AccountChangedError'));
  await a.in(() => assert.rejects(a.api.apiFetch('/api/workspace'), (e) => e.name === 'AccountChangedError'));
  assert.deepEqual(sent, [], 'no request left tab A');

  // A keeps typing: the text must not land in B's drafts.
  a.in(() => a.drafts.writeDraft('chat-of-a', 'more of A\'s text'));
  assert.equal(storage.peek('noevia:chat-drafts'), null);

  // The event path: the app is unmounted and the page reloads once, however many signals arrive.
  storageEvent(a); storageEvent(a);
  assert.equal(a.env.window.reloads, 1);
  assert.equal(a.env.window.events.filter((t) => t === 'noevia:account-changed').length, 1);
  a.in(() => a.cache.cached('k', async () => { cacheLoads += 1; return 2; }));
  assert.equal(cacheLoads, 2, 'the shared request cache was cleared');
  assert.equal(b.env.window.reloads, 0, 'the tab that signed in is left alone');
  // B itself keeps working normally.
  await b.in(() => b.api.apiFetch('/api/workspace'));
  assert.equal(sent.length, 1);
  b.in(() => b.drafts.writeDraft('chat-of-b', 'b text'));
  assert.match(storage.peek('noevia:chat-drafts'), /b text/);
}));

test('signing out in another tab also stops this tab', () => twoTabs(async ({ tabs, sent, storageEvent }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  b.in(() => { b.device.claimDeviceState('user-a'); b.device.clearDeviceState(); });
  await a.in(() => assert.rejects(a.api.apiFetch('/api/workspace'), (e) => e.name === 'AccountChangedError'));
  storageEvent(a);
  assert.equal(a.env.window.reloads, 1);
  assert.deepEqual(sent, []);
}));

test('the same account open in two tabs is never treated as a change', () => twoTabs(async ({ tabs, sent, storageEvent }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  b.in(() => b.device.claimDeviceState('user-a'));
  storageEvent(a);
  await a.in(() => a.api.apiFetch('/api/workspace'));
  a.in(() => a.drafts.writeDraft('chat-of-a', 'still mine'));
  assert.equal(a.env.window.reloads, 0);
  assert.equal(sent.length, 1);
}));

test('a tab on the sign-in screen is not reloaded by another tab\'s sign-in, and signs in normally', () => twoTabs(async ({ tabs, storageEvent }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); a.sessionMod.unbindTabAccount(); }); // a 401 showed the sign-in
  b.in(() => b.device.claimDeviceState('user-b'));
  storageEvent(a);
  assert.equal(a.env.window.reloads, 0);
  await a.in(() => a.api.apiFetch('/api/auth/login/password', { method: 'POST', body: '{}' }));
  a.in(() => a.device.claimDeviceState('user-b'));
  await a.in(() => a.api.apiFetch('/api/workspace'));
}));

test('with the marker unusable, looking at the tab again asks the server and a different account reloads it', () => twoTabs(async ({ tabs, storage, sent, session }) => {
  const { a } = tabs;
  const broken = { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} };
  globalThis.localStorage = broken;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  // A marker that cannot be stored must not read as "someone else": requests still go.
  await a.in(() => a.api.apiFetch('/api/workspace'));
  assert.equal(sent.length, 1);

  session.user = 'user-a';
  a.in(() => a.env.window.dispatchEvent(new Event('focus')));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.env.window.reloads, 0, 'same account: nothing happens');

  session.user = 'user-b';
  a.in(() => a.env.window.dispatchEvent(new Event('focus')));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.env.window.reloads, 1);
  await a.in(() => assert.rejects(a.api.apiFetch('/api/workspace'), (e) => e.name === 'AccountChangedError'));
  assert.equal(sent.length, 1, 'nothing more is sent once stale');
  void storage;
}));

test('a session that is gone when the tab is looked at again also reloads it; going offline does not', () => twoTabs(async ({ tabs, session }) => {
  const { a } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  a.in(() => a.env.document.dispatchEvent(new Event('visibilitychange')));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.env.window.reloads, 0, 'a network error says nothing about the account');
  globalThis.fetch = realFetch;
  session.user = null;
  a.in(() => a.env.document.dispatchEvent(new Event('visibilitychange')));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.env.window.reloads, 1);
}));

test('AuthGate unmounts the app on the change, watches for it, and the wizard path binds the account', () => {
  const gate = fs.readFileSync(path.join(root, 'src/components/AuthGate.tsx'), 'utf8');
  assert.match(gate, /window\.addEventListener\(ACCOUNT_CHANGED_EVENT, accountChanged\)/);
  assert.match(gate, /const accountChanged = \(\) => \{ blocked = true; setOnboardingUser\(null\); setScreen\('checking'\); \};/);
  assert.match(gate, /const stopWatching = watchAccountSession\(\);/);
  assert.match(gate, /const lock = \(\) => \{ unbindTabAccount\(\);/);
  assert.match(gate, /mode="fresh" onFinished=\{\(\) => \{ setScreen\('ready'\); void probeSession\(\)\.then\(\(user\) => \{ if \(user\) claimDeviceState\(user\.id\); \}\)/);
  const api = fs.readFileSync(path.join(root, 'src/api.ts'), 'utf8');
  assert.match(api, /export async function apiFetch\([^)]*\)[^{]*\{\n(?:\s*\/\/.*\n)*\s*if \(accountChangedElsewhere\(\)\) throw new AccountChangedError\(\);/, 'every API call checks first');
  assert.match(api, /if \(accountChangedElsewhere\(\)\) \{ reject\(new AccountChangedError\(\)\); return; \}/, 'so does the upload');
});
