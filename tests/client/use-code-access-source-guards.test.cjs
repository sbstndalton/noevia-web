// #450: useCodeAccess.ts must never probe fetchCode with an empty/placeholder id (that was the
// bug — CodingWorkspace/Sidebar passed '-' before a real project id existed), and its fetch effect
// must guard a superseded ('stale') response the same way the rest of the codebase's async
// effects do (the `live` flag). Actually exercising the effect (React, timers, a browser) is
// qa/code-access-flash-450.cjs and the pure-logic tests in code-access-state.test.cjs; a plain
// Node test can pin down the source shape so a future edit cannot silently reintroduce either bug
// while still looking correct at a glance (see tests/client/diary-lazy-mount.test.cjs for the same idea).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/code/useCodeAccess.ts'), 'utf8');

test('the hook never hard-codes a placeholder project id (e.g. the literal \'-\' that used to 404)', () => {
  assert.doesNotMatch(src, /['"]-['"]/, "no literal '-' placeholder id in useCodeAccess.ts");
});

test('fetchCodeAccess is only ever called with the real, non-empty projectId — syncCodeAccess is checked first', () => {
  // The effect must resolve synchronously (skip the fetch) before ever calling fetchCodeAccess.
  const effectStart = src.indexOf('useEffect(');
  assert.ok(effectStart !== -1, 'expected a useEffect');
  const probeIndex = src.indexOf('fetchCodeAccess(', effectStart);
  assert.ok(probeIndex !== -1, 'expected the effect to call fetchCodeAccess');
  const effectBody = src.slice(effectStart, probeIndex);
  assert.match(effectBody, /syncCodeAccess\(/, 'syncCodeAccess must be checked before fetchCodeAccess is called');
  assert.match(effectBody, /if\s*\(\s*sync\s*\)\s*\{[\s\S]*?return;\s*\}/, 'a synchronous answer must return before reaching fetchCodeAccess');
});

test('the probe itself (fetchCodeAccess) is imported from ./api — the same shared cache #425 gave fetchProfile/fetchFeatureFlags (#458), not the raw uncached fetchCode CodePanel polls with', () => {
  assert.match(src, /import\s*\{\s*fetchCodeAccess\s*\}\s*from\s*'\.\/api'/, 'expected useCodeAccess.ts to import the cached fetchCodeAccess, not fetchCode directly');
});

test('the fetch effect guards a superseded response with a `live` flag, set false on cleanup', () => {
  const effectStart = src.indexOf('useEffect(');
  const effectEnd = src.indexOf('}, [', effectStart);
  const effect = src.slice(effectStart, effectEnd);
  assert.match(effect, /let live = true/, 'expected a `live` guard flag');
  assert.match(effect, /if \(live\) setSnapshot\(\{ projectId, state: 'allowed' \}\)/, 'the allowed branch must check `live` before applying');
  assert.match(effect, /if \(live\) setSnapshot\(\{ projectId, state: 'denied' \}\)/, 'the denied branch must check `live` before applying');
  assert.match(effect, /return \(\) => \{ live = false; \}/, 'cleanup must flip `live` false so a superseded id\'s response is ignored');
});

test('the exposed value for the current render never trusts a snapshot for a different id (resolvedCodeAccess, not raw snapshot.state)', () => {
  const afterEffect = src.slice(src.lastIndexOf('}, ['));
  assert.match(afterEffect, /resolvedCodeAccess\(snapshot, projectId\)/, 'the hook must derive its return value through resolvedCodeAccess, not read snapshot.state directly');
});
