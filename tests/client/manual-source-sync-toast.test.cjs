// Regression: the manual "save project settings" sync path used to read r.skipped.length
// directly (throwing "That did not save" when the server omitted skipped) and never called
// resolveSkippedToast, so a clean manual sync left a stale skipped-sources toast on screen.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');

test('manual source sync routes through resolveSkippedToast, same as the watcher path', () => {
  const matches = [...src.matchAll(/resolveSkippedToast\(/g)];
  assert.equal(matches.length, 2, 'expected both the watcher and manual sync paths to call resolveSkippedToast');
});

test('manual source sync tolerates a missing r.skipped instead of throwing', () => {
  assert.match(src, /resolveSkippedToast\(prev, r\.skipped \|\| \[\], prevError, tr\)/);
});
