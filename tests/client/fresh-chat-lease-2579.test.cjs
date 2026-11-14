'use strict';
// sbstndalton/noevia#2579: a new chat is leased by the tab showing it, so a second tab loading the same saved place starts its own.
// Browser proof: qa/two-tabs-new-chat-2579.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');

function tab(store, session = new Map()) {
  const mk = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) });
  const localStorage = mk(store), sessionStorage = mk(session);
  const exports_ = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/fresh-chat-lease.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: exports_, localStorage, sessionStorage, Date, Math, JSON, Number, Object });
  return exports_;
}
const T0 = 1_000_000;

test('a tab does not see its own lease as another tab\'s', () => {
  const a = tab(new Map());
  a.holdFreshChat('c-1', T0);
  assert.equal(a.leasedByAnotherTab('c-1', T0 + 1), false);
});

test('another tab sees a live lease for that chat only', () => {
  const store = new Map(), a = tab(store), b = tab(store);
  a.holdFreshChat('c-1', T0);
  assert.equal(b.leasedByAnotherTab('c-1', T0 + 1000), true);
  assert.equal(b.leasedByAnotherTab('c-2', T0 + 1000), false);
});

test('a lease that was not renewed for ten seconds is gone (a crashed tab)', () => {
  const store = new Map(), a = tab(store), b = tab(store);
  a.holdFreshChat('c-1', T0);
  assert.equal(b.leasedByAnotherTab('c-1', T0 + a.LEASE_MS - 1), true);
  assert.equal(b.leasedByAnotherTab('c-1', T0 + a.LEASE_MS), false);
});

test('the holder gives it up; another tab cannot give it up for it', () => {
  const store = new Map(), a = tab(store), b = tab(store);
  a.holdFreshChat('c-1', T0);
  b.releaseFreshChat('c-1', T0 + 1);
  assert.equal(b.leasedByAnotherTab('c-1', T0 + 1), true);
  a.releaseFreshChat('c-2', T0 + 1);
  assert.equal(b.leasedByAnotherTab('c-1', T0 + 1), true, 'a different chat id releases nothing');
  a.releaseFreshChat('c-1', T0 + 1);
  assert.equal(b.leasedByAnotherTab('c-1', T0 + 1), false);
});

test('each tab keeps its own lease: two tabs on two new chats do not overwrite each other', () => {
  const store = new Map(), a = tab(store), b = tab(store), c = tab(store);
  a.holdFreshChat('c-A', T0);
  b.holdFreshChat('c-B', T0 + 1000);
  a.holdFreshChat('c-A', T0 + 3000);
  b.holdFreshChat('c-B', T0 + 4000);
  // Tab A reloads (its pagehide gave c-A up) while B keeps renewing; a new tab then loads and sees B's lease at any time.
  a.releaseFreshChat('c-A', T0 + 4500);
  assert.equal(c.leasedByAnotherTab('c-B', T0 + 4600), true);
  assert.equal(c.leasedByAnotherTab('c-A', T0 + 4600), false, 'the released one is free for the reloading tab');
  a.holdFreshChat('c-A', T0 + 5000);
  assert.equal(c.leasedByAnotherTab('c-A', T0 + 5100) && c.leasedByAnotherTab('c-B', T0 + 5100), true);
});

test('the tab remembers its own new chat for reloads only (session storage), and can forget it', () => {
  const store = new Map(), session = new Map(), a = tab(store, session);
  assert.equal(a.ownNewChat(), null);
  a.rememberOwnNewChat('c-9');
  assert.equal(tab(store, session).ownNewChat(), 'c-9', 'a reload of the tab sees it');
  assert.equal(tab(store, new Map()).ownNewChat(), null, 'another tab does not');
  a.rememberOwnNewChat(null);
  assert.equal(a.ownNewChat(), null);
});

test('unreadable storage reads as no lease', () => {
  const store = new Map([['noevia:fresh-chat-leases', 'not json']]);
  assert.equal(tab(store).leasedByAnotherTab('c-1', T0), false);
  const odd = new Map([['noevia:fresh-chat-leases', JSON.stringify({ 'c-1': { tab: 5, at: 'x' }, 'c-2': null })]]);
  assert.equal(tab(odd).leasedByAnotherTab('c-1', T0) || tab(odd).leasedByAnotherTab('c-2', T0), false);
});
