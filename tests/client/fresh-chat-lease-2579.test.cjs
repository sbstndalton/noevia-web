'use strict';
// sbstndalton/noevia#2579: a new chat is leased by the tab showing it, so a second tab loading the same saved place starts its own.
// Browser proof: qa/two-tabs-new-chat-2579.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');

function tab(store) {
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const exports_ = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/fresh-chat-lease.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: exports_, localStorage, Date, Math, JSON, Number });
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
  b.releaseFreshChat('c-1');
  assert.equal(b.leasedByAnotherTab('c-1', T0 + 1), true);
  a.releaseFreshChat('c-2');
  assert.equal(b.leasedByAnotherTab('c-1', T0 + 1), true, 'a different chat id releases nothing');
  a.releaseFreshChat('c-1');
  assert.equal(b.leasedByAnotherTab('c-1', T0 + 1), false);
});

test('unreadable or blocked storage reads as no lease', () => {
  const store = new Map([['noevia:fresh-chat-lease', 'not json']]);
  assert.equal(tab(store).leasedByAnotherTab('c-1', T0), false);
});
