'use strict';
// #791: unsent drafts (keyed by chat id only) and the last place (which names a chat) are this
// account's. Sign-out removes them; a sign-in by anyone else drops them before the app renders.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    keys: () => [...store.keys()],
  };
}

const src = (name) => path.join(__dirname, '../../src', name);
function load(name, requireMap) {
  const exports_ = {};
  const code = ts.transpileModule(fs.readFileSync(src(name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, require: (id) => requireMap[id], localStorage: global.localStorage, JSON, Date, Object });
  return exports_;
}
// #905: sign-in and sign-out also claim and clear the cached account preferences.
const preferences = () => load('user-preferences.ts', { react: { useEffect() {}, useSyncExternalStore() {} }, './api': { apiFetch() {} } });
function fresh() {
  global.localStorage = fakeLocalStorage();
  const drafts = load('chat-drafts.ts', {});
  const lastView = load('last-view.ts', {});
  const device = load('account-device-state.ts', { './chat-drafts': drafts, './last-view': lastView, './user-preferences': preferences() });
  return { drafts, lastView, device, storage: global.localStorage };
}
const place = (user, chatId = 'chat-of-a') => ({ user, view: { kind: 'chat', chatId, projectId: null }, settings: null });

test('sign-out removes every draft and the last place from the device', () => {
  const { drafts, lastView, device, storage } = fresh();
  device.claimDeviceState('user-a');
  drafts.writeDraft('chat-of-a', 'synthetic unsent text');
  lastView.writeLastPlace(place('user-a'));
  device.clearDeviceState();
  assert.equal(storage.getItem('noevia:chat-drafts'), null);
  assert.equal(storage.getItem('noevia:chat-drafts-owner'), null);
  assert.equal(storage.getItem('noevia:last-view'), null);
  assert.equal(drafts.readDraft('chat-of-a'), '');
});

test('another account signing in never sees the previous account\'s drafts or last chat', () => {
  const { drafts, lastView, device, storage } = fresh();
  device.claimDeviceState('user-a');
  drafts.writeDraft('chat-of-a', 'synthetic unsent text');
  lastView.writeLastPlace(place('user-a'));
  // Session expired (no sign-out click), then B signs in on the same browser.
  device.claimDeviceState('user-b');
  assert.equal(drafts.readDraft('chat-of-a'), '');
  assert.equal(storage.getItem('noevia:chat-drafts'), null, 'A\'s text is not kept in storage either');
  assert.equal(lastView.readLastPlace(), null, 'B does not start on A\'s last chat');
  assert.equal(storage.getItem('noevia:chat-drafts-owner'), 'user-b');
  // B's own drafts then work as before.
  drafts.writeDraft('chat-of-b', 'b text');
  assert.equal(drafts.readDraft('chat-of-b'), 'b text');
});

test('the same account signing in again keeps its drafts and its last place', () => {
  const { drafts, lastView, device } = fresh();
  device.claimDeviceState('user-a');
  drafts.writeDraft('chat-of-a', 'synthetic unsent text');
  lastView.writeLastPlace(place('user-a'));
  device.claimDeviceState('user-a');
  assert.equal(drafts.readDraft('chat-of-a'), 'synthetic unsent text');
  assert.equal(lastView.readLastPlace().view.chatId, 'chat-of-a');
});

test('drafts saved before owners were recorded are kept only for the account the last place names', () => {
  let s = fresh();
  s.drafts.writeDraft('chat-of-a', 'legacy text');
  s.lastView.writeLastPlace(place('user-a'));
  s.device.claimDeviceState('user-a');
  assert.equal(s.drafts.readDraft('chat-of-a'), 'legacy text', 'the owner\'s own legacy drafts survive the upgrade');

  s = fresh();
  s.drafts.writeDraft('chat-of-a', 'legacy text');
  s.lastView.writeLastPlace(place('user-a'));
  s.device.claimDeviceState('user-b');
  assert.equal(s.drafts.readDraft('chat-of-a'), '');

  s = fresh();
  s.drafts.writeDraft('chat-of-a', 'legacy text');
  s.device.claimDeviceState('user-b');
  assert.equal(s.drafts.readDraft('chat-of-a'), '', 'unknown owner: dropped');

  s = fresh();
  s.storage.setItem('noevia:last-view', JSON.stringify(place(null)));
  s.device.claimDeviceState('user-b');
  assert.equal(s.lastView.readLastPlace(), null, 'a place with no recorded account is not reopened for anyone');
});

test('a place is never written before the account is known, so a reload keeps this account\'s own', () => {
  const { lastView, device } = fresh();
  device.claimDeviceState('user-a');
  lastView.writeLastPlace(place('user-a', 'chat-of-a'));
  // App mounts and renders before /api/profile resolves: its first write has no account yet.
  lastView.writeLastPlace(place(null, 'fresh-chat'));
  assert.equal(lastView.readLastPlace().user, 'user-a', 'the null-account write did not replace it');
  device.claimDeviceState('user-a');
  assert.equal(lastView.readLastPlace()?.view.chatId, 'chat-of-a', 'the same account reopens its own last chat');
  const app = fs.readFileSync(src('App.tsx'), 'utf8');
  assert.match(app, /if \(view\.kind === 'preview'\) return;\s*\n(?:\s*\/\/.*\n)*\s*if \(!accountId\) return;/, 'App\'s last-place effect waits for the account');
});

test('storage being unavailable never throws out of sign-in or sign-out', () => {
  global.localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } };
  const drafts = load('chat-drafts.ts', {}), lastView = load('last-view.ts', {});
  const device = load('account-device-state.ts', { './chat-drafts': drafts, './last-view': lastView, './user-preferences': preferences() });
  assert.doesNotThrow(() => device.claimDeviceState('user-a'));
  assert.doesNotThrow(() => device.clearDeviceState());
});

test('sign-out and every sign-in path are wired to the device state', () => {
  const api = fs.readFileSync(src('api.ts'), 'utf8');
  assert.match(api, /export const logout = \(\) => postJson<[^>]+>\('\/api\/auth\/logout', \{\}\)\.then\(\(v\) => \{[^}]*clearDeviceState\(\)/);
  const gate = fs.readFileSync(src('components/AuthGate.tsx'), 'utf8');
  // Probe, password and passkey: each claims before the app can render for the user.
  assert.equal((gate.match(/claimDeviceState\((?:user|session\.user)\.id\);\s*\n\s*setOnboardingUser/g) || []).length, 3);
});
