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
  // Time is the tabs' own clock for the probe throttle and the "signing in" expiry.
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  const probes = [];
  const held = [];
  globalThis.localStorage = storage;
  globalThis.sessionStorage = { removeItem() {}, getItem: () => null, setItem() {} };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/account/preferences' && held.length === 0 && globalThis.__holdPreferences) {
      return new Promise((resolve) => held.push(() => resolve(new Response(JSON.stringify({ notifications: { replyFinished: false, approvalNeeded: false }, sendKey: 'mod-enter', locale: 'de-DE' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    }
    if (url === '/api/auth/session') {
      probes.push(Date.now());
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
      prefs: await load('/src/user-preferences.ts'),
      flags: await load('/src/components/features/useFeatureFlags.ts'),
      // Run code "inside" a tab: the module under test reads window/document at call time.
      in(run) { globalThis.window = env.window; globalThis.document = env.document; return run(); },
    };
  }
  try {
    return await fn({ tabs, storage, sent, session, probes, held, advance: (ms) => { skew += ms; }, storageEvent: (tab) => tab.in(() => { const e = new Event('storage'); e.key = 'noevia:session-account'; tab.env.window.dispatchEvent(e); }) });
  } finally {
    Date.now = realNow;
    delete globalThis.__holdPreferences;
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

test('with the marker unusable, looking at the tab again asks the server and a different account reloads it', () => twoTabs(async ({ tabs, storage, sent, session, advance }) => {
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
  advance(6000);
  a.in(() => a.env.window.dispatchEvent(new Event('focus')));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.env.window.reloads, 1);
  await a.in(() => assert.rejects(a.api.apiFetch('/api/workspace'), (e) => e.name === 'AccountChangedError'));
  assert.equal(sent.length, 1, 'nothing more is sent once stale');
  void storage;
}));

test('a session that is gone when the tab is looked at again also reloads it; going offline does not', () => twoTabs(async ({ tabs, session, advance }) => {
  const { a } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  a.in(() => a.env.document.dispatchEvent(new Event('visibilitychange')));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.env.window.reloads, 0, 'a network error says nothing about the account');
  globalThis.fetch = realFetch;
  session.user = null;
  advance(6000);
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

test('looking at the tab again asks the server at most once every five seconds', () => twoTabs(async ({ tabs, session, probes, advance }) => {
  const { a } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  session.user = 'user-a';
  const look = async () => { a.in(() => { a.env.window.dispatchEvent(new Event('focus')); a.env.document.dispatchEvent(new Event('visibilitychange')); }); await new Promise((r) => setTimeout(r, 10)); };
  await look(); await look();
  assert.equal(probes.length, 1, 'focus and visibilitychange together are one question');
  advance(5001);
  await look();
  assert.equal(probes.length, 2);
}));

test('an answer still in flight for stale tab A cannot store A\'s preferences under B (#1643)', () => twoTabs(async ({ tabs, storage, held }) => {
  const { a, b } = tabs;
  globalThis.__holdPreferences = true;
  a.in(() => { a.device.claimDeviceState('user-a'); });
  const answer = a.in(() => a.prefs.loadPreferences());
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(held.length, 1, 'the request left tab A before the switch');
  b.in(() => { b.device.clearDeviceState(); b.device.claimDeviceState('user-b'); });
  held[0]();
  await answer.catch(() => undefined);
  assert.equal(storage.peek('noevia:account-preferences'), null, 'A\'s language and send key are not in storage under B\'s owner key');
  assert.equal(storage.peek('noevia:account-preferences-owner'), 'user-b');
  // B's own tab still stores its own answer.
  globalThis.__holdPreferences = false;
  await b.in(() => b.prefs.loadPreferences());
  assert.ok(storage.peek('noevia:account-preferences'), 'B stores its own');
}));

test('the feature-flag cache write is guarded the same way', () => {
  const hook = fs.readFileSync(path.join(root, 'src/components/features/useFeatureFlags.ts'), 'utf8');
  assert.match(hook, /import \{ accountChangedElsewhere \} from '\.\.\/\.\.\/account-session';/);
  assert.match(hook, /if \(accountChangedElsewhere\(\)\) return;\n\s*try \{ localStorage\.setItem\(CACHE_KEY/);
});

test('a refused flag read keeps the last flags and is retried once the other tab\'s sign-in has settled', () => twoTabs(async ({ tabs }) => {
  const { a } = tabs;
  const timers = [], real = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = () => undefined;
  const applied = [];
  const refusal = (reason) => Object.assign(new Error('refused'), { name: 'AccountChangedError', reason });
  try {
    let reads = 0;
    const stop = a.in(() => a.flags.startFlagReads(() => (++reads === 1 ? Promise.reject(refusal('signing-in')) : Promise.resolve({ previews: true })), (f) => applied.push(f)));
    await new Promise((r) => real(r, 5));
    assert.deepEqual(applied, [], 'a refusal while someone signs in does not switch every flag off');
    assert.equal(timers.length, 1, 'and the read is scheduled again');
    timers[0].fn();
    await new Promise((r) => real(r, 5));
    assert.deepEqual(applied, [{ previews: true }]);
    stop();

    // The account changed: the page reloads, so no retry and no flags written either.
    applied.length = 0; timers.length = 0;
    a.in(() => a.flags.startFlagReads(() => Promise.reject(refusal('changed')), (f) => applied.push(f)));
    await new Promise((r) => real(r, 5));
    assert.deepEqual(applied, []); assert.equal(timers.length, 0);

    // Any other failure still means "no flags".
    a.in(() => a.flags.startFlagReads(() => Promise.reject(new Error('500')), (f) => applied.push(f)));
    await new Promise((r) => real(r, 5));
    assert.deepEqual(applied, [{}]);

    // The retries are bounded.
    timers.length = 0;
    a.in(() => a.flags.startFlagReads(() => Promise.reject(refusal('signing-in')), () => undefined));
    for (let i = 0; i < 15; i += 1) { await new Promise((r) => real(r, 2)); const next = timers.shift(); if (next) next.fn(); }
    assert.equal(timers.length, 0, 'gives up after ten tries');
  } finally { globalThis.setTimeout = real; globalThis.clearTimeout = realClear; }
}));

test('a refusal says which it is: a change reloads, a sign-in in progress does not', () => twoTabs(async ({ tabs }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  let restore;
  b.in(() => { restore = b.sessionMod.beginSignIn(); });
  const err = await a.in(() => a.api.apiFetch('/api/workspace').catch((e) => e));
  assert.equal(err.name, 'AccountChangedError');
  assert.equal(err.reason, 'signing-in');
  assert.doesNotMatch(err.message, /reload/i, 'nothing is reloading, so the message does not say so');
  b.in(() => restore());
  b.in(() => b.device.claimDeviceState('user-b'));
  const changed = await a.in(() => a.api.apiFetch('/api/workspace').catch((e) => e));
  assert.equal(changed.reason, 'changed');
  assert.match(changed.message, /Reloading/);
}));

test('two refused sign-ins end on the account that was there before either, in either order', () => twoTabs(async ({ tabs, storage }) => {
  const { a, b } = tabs;
  for (const order of [['x', 'y'], ['y', 'x']]) {
    a.in(() => a.device.claimDeviceState('user-a'));
    let rx, ry;
    b.in(() => { rx = b.sessionMod.beginSignIn(); });
    a.in(() => { ry = a.sessionMod.beginSignIn(); }); // a second login tab overwrites the first one's marker
    for (const who of order) (who === 'x' ? rx : ry)();
    assert.equal(storage.peek('noevia:session-account'), 'user-a', `order ${order}`);
  }
  // With nobody signed in before, a refused pair leaves no marker.
  storage.removeItem('noevia:session-account');
  const r1 = b.in(() => b.sessionMod.beginSignIn()), r2 = a.in(() => a.sessionMod.beginSignIn());
  r2(); r1();
  assert.equal(storage.peek('noevia:session-account'), null);
}));

test('a stale marker while offline costs one probe per interval, not one per request', () => twoTabs(async ({ tabs, probes, advance }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); });
  b.in(() => b.sessionMod.beginSignIn());
  advance(31000);
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => { if (url === '/api/auth/session') { calls += 1; throw new TypeError('offline'); } return realFetch(url); };
  try {
    for (let i = 0; i < 20; i += 1) a.in(() => { void a.api.apiFetch('/api/workspace').catch(() => undefined); });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 1, 'one probe in flight, however many requests find the marker');
    for (let i = 0; i < 20; i += 1) a.in(() => { void a.api.apiFetch('/api/workspace').catch(() => undefined); });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 1, 'and no second one inside five seconds');
    advance(5001);
    a.in(() => { void a.api.apiFetch('/api/workspace').catch(() => undefined); });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = realFetch; }
  void probes;
}));

test('the two new messages exist in every locale', () => {
  const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');
  for (const locale of LOCALES) {
    const c = catalogue(locale);
    assert.ok(c['account.changedElsewhere'], `${locale} changedElsewhere`);
    assert.ok(c['account.signingInElsewhere'], `${locale} signingInElsewhere`);
  }
});

test('a tab that is signing in stops the others at once; a refused credential puts everything back, a granted one reloads them', () => twoTabs(async ({ tabs, storage, sent, storageEvent }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  // Tab B is about to send a password: the marker goes in BEFORE any cookie exists.
  let restore;
  b.in(() => { restore = b.sessionMod.beginSignIn(); });
  assert.match(storage.peek('noevia:session-account'), /^signing-in:/);
  await a.in(() => assert.rejects(a.api.apiFetch('/api/chat', { method: 'POST', body: 'SYNTHETIC A draft' }), (e) => e.name === 'AccountChangedError'));
  a.in(() => a.drafts.writeDraft('chat-of-a', 'typed while B signs in'));
  assert.equal(storage.peek('noevia:chat-drafts'), null, 'nothing of A is written meanwhile');
  storageEvent(a);
  assert.equal(a.env.window.reloads, 0, 'the page is kept: the sign-in may still fail');
  assert.deepEqual(sent, []);

  // Wrong password: the old marker returns and A carries on, unreloaded.
  b.in(() => restore());
  assert.equal(storage.peek('noevia:session-account'), 'user-a');
  storageEvent(a);
  await a.in(() => a.api.apiFetch('/api/workspace'));
  a.in(() => a.drafts.writeDraft('chat-of-a', 'back to normal'));
  assert.equal(sent.length, 1);
  assert.match(storage.peek('noevia:chat-drafts'), /back to normal/);
  assert.equal(a.env.window.reloads, 0);

  // Second try succeeds: B's claim replaces the marker and A reloads.
  b.in(() => { restore = b.sessionMod.beginSignIn(); });
  b.in(() => b.device.claimDeviceState('user-b'));
  b.in(() => restore()); // a late restore must not undo B's own marker
  assert.equal(storage.peek('noevia:session-account'), 'user-b');
  storageEvent(a);
  assert.equal(a.env.window.reloads, 1);
}));

test('a "signing in" marker left by a tab that died goes stale: the tab asks the server and carries on, or reloads', () => twoTabs(async ({ tabs, storage, sent, session, advance }) => {
  const { a, b } = tabs;
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  b.in(() => b.sessionMod.beginSignIn()); // never restored, never claimed
  session.user = 'user-a';
  advance(31000);
  a.in(() => { void a.api.apiFetch('/api/workspace').catch(() => undefined); });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(storage.peek('noevia:session-account'), 'user-a', 'the server said it is still A: the marker is put right');
  await a.in(() => a.api.apiFetch('/api/workspace'));
  assert.equal(a.env.window.reloads, 0);
  assert.ok(sent.length >= 1);

  b.in(() => b.sessionMod.beginSignIn());
  session.user = 'user-b';
  advance(31000);
  a.in(() => { void a.api.apiFetch('/api/workspace').catch(() => undefined); });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(a.env.window.reloads, 1, 'the server says B: reload');
}));

test('a reload that is declined (the Diary\'s unsaved-text prompt) leaves a notice with a reload button instead of an empty page', () => twoTabs(async ({ tabs, storageEvent }) => {
  const { a, b } = tabs;
  const real = globalThis.setTimeout, timers = [];
  a.in(() => { a.device.claimDeviceState('user-a'); a.sessionMod.watchAccountSession(); });
  b.in(() => b.device.claimDeviceState('user-b'));
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
  try { storageEvent(a); } finally { globalThis.setTimeout = real; }
  assert.equal(a.env.window.reloads, 1);
  assert.ok(!a.env.window.events.includes('noevia:account-reload-blocked'), 'not before the grace period');
  timers.find((t) => t.ms >= 1000).fn(); // the page is still here after it
  assert.ok(a.env.window.events.includes('noevia:account-reload-blocked'));
  const gate = fs.readFileSync(path.join(root, 'src/components/AuthGate.tsx'), 'utf8');
  assert.match(gate, /const reloadBlocked = \(\) => setScreen\('account-changed'\);/);
  assert.match(gate, /if \(screen === 'account-changed'\) return[\s\S]*?<h1>Account changed<\/h1>[\s\S]*?window\.location\.reload\(\)[\s\S]*?Reload page/);
}));

test('every credential request is preceded by the signing-in marker, and a refusal restores it', () => {
  const gate = fs.readFileSync(path.join(root, 'src/components/AuthGate.tsx'), 'utf8');
  const submit = gate.slice(gate.indexOf('const submit = async'), gate.indexOf('const usePasskey'));
  assert.ok(submit.indexOf('beginSignIn()') < submit.indexOf('completeRecovery('), 'recovery');
  assert.ok(submit.indexOf('beginSignIn()') < submit.indexOf('acceptInvitation('), 'invitation');
  assert.ok(submit.indexOf('beginSignIn()') < submit.indexOf('passwordLogin('), 'password');
  assert.match(submit, /\} catch \(e\) \{ restore\(\); throw e; \}/);
  const passkey = gate.slice(gate.indexOf('const usePasskey'), gate.indexOf('const addPasskey'));
  assert.match(passkey, /const restore = beginSignIn\(\);[^\n]*\n\s*try \{ await passkeyLoginVerify\([^)]*\); \} catch \(e\) \{ restore\(\); throw e; \}/);
  assert.ok(passkey.indexOf('passkeyLoginOptions') < passkey.indexOf('beginSignIn()'), 'the marker is not held while the device prompt waits');
});
