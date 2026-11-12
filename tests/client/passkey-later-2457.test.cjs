// #2457: "Set up later" on the passkey step holds for 30 days per account in this browser (browser proof: qa/passkey-later-2457.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const exports_ = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/passkey-later.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: exports_, localStorage, Number, Date });
  return { ...exports_, store };
}
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);

test('nothing chosen: the step is due', () => {
  assert.equal(load().passkeyStepDeferred('u1', T0), false);
});

test('chosen: held for 30 days, due again from day 30', () => {
  const m = load();
  m.deferPasskeyStep('u1', T0);
  assert.equal(m.passkeyStepDeferred('u1', T0 + 29 * DAY), true);
  assert.equal(m.passkeyStepDeferred('u1', T0 + 30 * DAY), false);
  assert.equal(m.passkeyStepDeferred('u1', T0 + 31 * DAY), false);
});

test('per account: another account is not deferred', () => {
  const m = load();
  m.deferPasskeyStep('u1', T0);
  assert.equal(m.passkeyStepDeferred('u2', T0), false);
});

test('registering a passkey clears it', () => {
  const m = load();
  m.deferPasskeyStep('u1', T0);
  m.clearPasskeyStepDeferral('u1');
  assert.equal(m.passkeyStepDeferred('u1', T0), false);
});

test('garbage or a future time (clock moved back) counts as not chosen', () => {
  const m = load();
  m.store.set('noevia-passkey-later:u1', 'soon');
  assert.equal(m.passkeyStepDeferred('u1', T0), false);
  m.store.set('noevia-passkey-later:u1', String(T0 + DAY));
  assert.equal(m.passkeyStepDeferred('u1', T0), false);
});
