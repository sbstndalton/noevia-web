'use strict';
// #905: the cached account preferences (`noevia:account-preferences`: language, Enter behaviour,
// notification choices) belong to one account. Sign-out removes them from the device and from
// memory; a sign-in by a different account resets them to the defaults before the app renders, so
// the next person never gets the previous one's choices while (or if never) their own record loads.
// Also: an upload whose follow-up refresh throws reports a failure instead of an unhandled rejection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const src = (name) => path.join(__dirname, '../../src', name);
function fakeLocalStorage() {
  const store = new Map();
  return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
}
function load(name, requireMap, extra = {}) {
  const exports_ = {};
  const code = ts.transpileModule(fs.readFileSync(src(name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exports_, require: (id) => { if (!(id in requireMap)) throw Error(`unexpected require ${id}`); return requireMap[id]; }, localStorage: global.localStorage, JSON, Date, Object, Error, Promise, ...extra });
  return exports_;
}
const KEY = 'noevia:account-preferences', OWNER = 'noevia:account-preferences-owner';
const A_PREFS = { notifications: { replyFinished: false, approvalNeeded: false }, sendKey: 'mod-enter', locale: 'de-DE' };

function fresh({ storage = fakeLocalStorage(), apiFetch = async () => { throw Error('offline'); } } = {}) {
  global.localStorage = storage;
  const events = [];
  const window = { dispatchEvent: (e) => events.push(e.type), addEventListener() {}, removeEventListener() {} };
  const prefs = load('user-preferences.ts', { react: { useEffect() {}, useSyncExternalStore() {} }, './api': { apiFetch: (...a) => apiFetch(...a) } }, { window, Event: class { constructor(type) { this.type = type; } } });
  const device = load('account-device-state.ts', {
    './chat-drafts': { claimDrafts() {}, clearAllDrafts() {} },
    './last-view': { readLastPlace: () => null, clearLastPlace() {} },
    './user-preferences': prefs,
  });
  return { prefs, device, storage, events };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const DEFAULTS = { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'system' };

test('sign-out removes the cached preferences and their owner, and resets the in-memory copy', () => {
  const storage = fakeLocalStorage();
  storage.setItem(KEY, JSON.stringify(A_PREFS));
  storage.setItem(OWNER, 'user-a');
  const { prefs, device, events } = fresh({ storage });
  device.claimDeviceState('user-a');
  assert.equal(prefs.currentPreferences().sendKey, 'mod-enter', 'the same account keeps its cached copy');
  device.clearDeviceState();
  assert.equal(storage.getItem(KEY), null);
  assert.equal(storage.getItem(OWNER), null);
  assert.deepEqual(plain(prefs.currentPreferences()), DEFAULTS);
  assert.ok(events.includes('noevia:account-preferences-changed'), 'mounted readers are told');
});

test('a different account signing in gets the defaults, not the previous account\'s cache', () => {
  const storage = fakeLocalStorage();
  storage.setItem(KEY, JSON.stringify(A_PREFS));
  storage.setItem(OWNER, 'user-a');
  const { prefs, device } = fresh({ storage });
  assert.equal(prefs.currentPreferences().sendKey, 'mod-enter', 'module load read A\'s cache (page loaded before sign-in)');
  // Session expired without a sign-out click; B signs in on the same page.
  device.claimDeviceState('user-b');
  assert.deepEqual(plain(prefs.currentPreferences()), DEFAULTS);
  assert.equal(prefs.appLocale(), undefined);
  assert.equal(storage.getItem(KEY), null, 'A\'s choices are gone from storage too');
  assert.equal(storage.getItem(OWNER), 'user-b');
});

test('a cache saved before owners were recorded is treated as someone else\'s', () => {
  const storage = fakeLocalStorage();
  storage.setItem(KEY, JSON.stringify(A_PREFS));
  const { prefs, device } = fresh({ storage });
  device.claimDeviceState('user-a');
  assert.equal(prefs.currentPreferences().sendKey, 'enter');
  assert.equal(storage.getItem(KEY), null);
});

test('after a switch the new account\'s record is fetched again, and a late answer for the old one is dropped', async () => {
  const pending = [];
  const apiFetch = () => new Promise((resolve) => pending.push(resolve));
  const { prefs, device, storage } = fresh({ apiFetch });
  device.claimDeviceState('user-a');
  const forA = prefs.loadPreferences().catch(() => undefined);
  device.claimDeviceState('user-b');
  const forB = prefs.loadPreferences();
  assert.equal(pending.length, 2, 'B asks again instead of reusing A\'s request');
  pending[0]({ ok: true, json: async () => A_PREFS });
  await forA;
  assert.equal(prefs.currentPreferences().sendKey, 'enter', 'A\'s late answer does not land for B');
  pending[1]({ ok: true, json: async () => ({ ...DEFAULTS, locale: 'nb-NO' }) });
  await forB;
  assert.equal(prefs.currentPreferences().locale, 'nb-NO');
  assert.equal(JSON.parse(storage.getItem(KEY)).locale, 'nb-NO');
});

test('a save still in flight when the account changes does not land for the next account', async () => {
  const pending = [];
  const apiFetch = () => new Promise((resolve) => pending.push(resolve));
  const { prefs, device, storage } = fresh({ apiFetch });
  device.claimDeviceState('user-a');
  const saving = prefs.savePreferences({ sendKey: 'mod-enter' });
  device.claimDeviceState('user-b');
  pending[0]({ ok: true, json: async () => A_PREFS });
  await saving;
  assert.deepEqual(plain(prefs.currentPreferences()), DEFAULTS, 'B keeps the defaults');
  assert.equal(storage.getItem(KEY), null, 'A\'s saved choices are not written into B\'s cache');
  assert.equal(storage.getItem(OWNER), 'user-b');
  // The same after a sign-out instead of a switch.
  const again = prefs.savePreferences({ sendKey: 'mod-enter' });
  device.clearDeviceState();
  pending[1]({ ok: true, json: async () => A_PREFS });
  await again;
  assert.equal(storage.getItem(KEY), null);
  assert.equal(prefs.currentPreferences().sendKey, 'enter');
});

test('blocked storage never throws out of claim or clear', () => {
  const blocked = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } };
  const { device, prefs } = fresh({ storage: blocked });
  assert.doesNotThrow(() => device.claimDeviceState('user-a'));
  assert.doesNotThrow(() => device.clearDeviceState());
  assert.equal(prefs.currentPreferences().sendKey, 'enter');
});

test('an upload whose refresh throws reports a failure status instead of rejecting', async () => {
  global.localStorage = fakeLocalStorage();
  const t = Object.assign((key, params) => (params ? `${key} ${JSON.stringify(params)}` : key), { plural: (key, n) => `${key}:${n}`, locale: 'en-GB' });
  const actions = load('components/ComposerActions.tsx', {
    react: { useEffect() {}, useId() {}, useRef() {}, useState() {} },
    'react/jsx-runtime': { jsx() {}, jsxs() {}, Fragment: {} },
    '../api': { fetchToolboxes() {}, saveProjectConfig() {}, uploadProjectFile: async () => ({}) },
    '../sources': { fileToBase64: async () => 'AA==', uploadLimit: () => 1e9 },
    '../user-preferences': { appLocale: () => undefined },
    './ShellIcon': { ShellIcon() {} },
    '../source-status': { uploadFailureText: (err, _t, fallback) => err?.message || fallback, uploadUnreadableReason: () => '' },
    '../number-format': { formatPercent: () => '' },
    '../i18n': { useT: () => t },
    '../toolbox-copy': { toolboxCopy() {} },
    '../tools-mode': { toolsModeOf: () => 'manual' },
    './SegmentedControl': { SegmentedControl() {} },
  });
  const statuses = [], busy = [];
  const sink = { project: { id: 'p1', name: 'Synthetic' }, disabled: false, chatOnly: true, onChanged: async () => { throw Error('refresh failed (synthetic)'); }, onBusy: (b) => busy.push(b), onStatus: (s) => statuses.push(s) };
  await assert.doesNotReject(actions.uploadAttachments(sink, [{ name: 'a.txt', size: 3 }], t));
  const last = statuses.at(-1);
  assert.match(last, /^composer\.upload\.partial /);
  assert.match(last, /"saved":1,"total":1/);
  assert.match(last, /composer\.upload\.failed: refresh failed \(synthetic\)/);
  assert.deepEqual(busy, [true, false]);
});
