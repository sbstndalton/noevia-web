// #450: the New-task page ('/code') briefly showed the honest-but-wrong "not connected yet" stub
// on every load — useCodeAccess probed the placeholder project id '-' before the real project
// list arrived, and its boolean result defaulted to false (denied) while that probe was in
// flight. useCodeAccess.ts now delegates its state-transition decisions to the pure functions in
// code-access-state.ts, tested directly here — no React, no effects, no browser needed (the
// effect-driven "checking flips to allowed/denied" transition itself is qa/code-access-flash-450.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');

function loadModule(relPath) {
  const file = path.join(__dirname, '..', relPath);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => { throw new Error('unexpected import'); } });
  return exports;
}

const { syncCodeAccess, resolvedCodeAccess } = loadModule('../src/components/code/code-access-state.ts');

// ── syncCodeAccess: the answer that needs no probe at all ───────────────────────────────────────

test('no real project id yet: checking, never a probe (the #450 bug: this used to be treated as denied)', () => {
  assert.equal(syncCodeAccess('', true, true), 'checking');
});

test('the feature flag is off: denied outright, no id needed', () => {
  assert.equal(syncCodeAccess('', true, false), 'denied');
  assert.equal(syncCodeAccess('real-project-id', true, false), 'denied');
});

test('a caller that opted out (enabled=false, e.g. the sidebar outside Code mode): denied outright', () => {
  assert.equal(syncCodeAccess('', false, true), 'denied');
  assert.equal(syncCodeAccess('real-project-id', false, true), 'denied');
});

test('a real id, enabled, feature on: no synchronous answer — only a fetch can settle it', () => {
  assert.equal(syncCodeAccess('real-project-id', true, true), null);
});

// ── resolvedCodeAccess: this render's answer must be for *this* id, not a stale one ─────────────

test('a snapshot for the current id is returned as-is, allowed or denied', () => {
  assert.equal(resolvedCodeAccess({ projectId: 'p1', state: 'allowed' }, 'p1'), 'allowed');
  assert.equal(resolvedCodeAccess({ projectId: 'p1', state: 'denied' }, 'p1'), 'denied');
});

test('a snapshot for a different id (an earlier project still in flight, or a race) reads as checking, never leaking a stale answer', () => {
  // The classic case: project A resolved 'allowed', the viewer switched to project B, and B's own
  // probe has not landed yet — A's 'allowed' must not paint over B.
  assert.equal(resolvedCodeAccess({ projectId: 'p1', state: 'allowed' }, 'p2'), 'checking');
  assert.equal(resolvedCodeAccess({ projectId: 'p1', state: 'denied' }, 'p2'), 'checking');
  // The initial snapshot (projectId '') answering for any real id.
  assert.equal(resolvedCodeAccess({ projectId: '', state: 'checking' }, 'p1'), 'checking');
});

// ── the full sequence a caller walks through: no id → checking → allowed/denied, stale ignored ──

test('the sequence useCodeAccess drives: no id (checking) → a real id appears (still checking until its fetch answers) → allowed', () => {
  // Step 1: no real project id yet (the project list has not loaded).
  assert.equal(syncCodeAccess('', true, true), 'checking');
  // Step 2: a real id appears; syncCodeAccess defers to the fetch, so the hook falls through to
  // resolvedCodeAccess against whatever snapshot it still has (the initial one, for '').
  assert.equal(syncCodeAccess('p1', true, true), null);
  assert.equal(resolvedCodeAccess({ projectId: '', state: 'checking' }, 'p1'), 'checking');
  // Step 3: the fetch for p1 resolves — the hook's own effect would setSnapshot({projectId:'p1',state:'allowed'}).
  assert.equal(resolvedCodeAccess({ projectId: 'p1', state: 'allowed' }, 'p1'), 'allowed');
});

test('a stale response for an earlier id must not overwrite a newer id\'s pending check', () => {
  // The viewer moved from p1 (still in flight) to p2 before p1 answered. Once p1's fetch does
  // land, its snapshot is for 'p1' — but the current id is now 'p2', so it must read as checking,
  // not as p1's answer bleeding into p2's slot.
  const staleSnapshotForP1 = { projectId: 'p1', state: 'allowed' };
  assert.equal(resolvedCodeAccess(staleSnapshotForP1, 'p2'), 'checking');
});
