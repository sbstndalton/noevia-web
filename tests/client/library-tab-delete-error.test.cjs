// Regression for the LibraryTab delete-cleanup error toast never being visible: onDeleted() used
// to fire (unmounting the card via refresh) and only afterwards was the local error state set on
// a branch that no longer rendered. The fix routes the settings-cleanup error through onDeleted's
// argument so the parent's persistent error banner shows it even after the card unmounts.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/models/LibraryTab.tsx'), 'utf8');

test('DeleteModel forwards the cleanup error through onDeleted instead of a local error branch', () => {
  const calls = [...src.matchAll(/setConfirming\(false\);\s*onDeleted\((.*?)\); return;/g)].map(m => m[1]);
  assert.equal(calls.length, 2, 'expected both delete branches to forward via onDeleted(...)');
  // The English outcome.error gates it; the banner shows the translated cleanup sentence (#293).
  // The primary (files) delete branch also forwards the roles the server cleared off the deleted
  // model (#302), so its second argument may be present; the cache-only branch never has one.
  for (const arg of calls) assert.match(arg, /^outcome\.error && cleanupText\(outcome\.cleanupDetail\)(, outcome\.rolesCleared)?$/);
});

test('LibraryTab surfaces a forwarded delete error on its persistent error banner, removes the card optimistically, and surfaces cleared roles, before refreshing', () => {
  assert.match(src, /onDeleted=\{\(err, rolesCleared\) => \{/);
  assert.match(src, /if \(err\) setError\(err\);/);
  assert.match(src, /setModels\(prev => \(prev \|\| \[\]\)\.filter\(x => x\.name !== m\.name\)\);/);
  assert.match(src, /if \(rolesCleared && rolesCleared\.length\) setMessage\(t\('mm\.delete\.rolesCleared'/);
});

test('ModelCard/DeleteModel onDeleted signature accepts an optional error and the roles the server cleared', () => {
  assert.match(src, /onDeleted:\s*\(error\?:\s*string\s*\|\s*null,\s*rolesCleared\?:\s*string\[\]\)\s*=>\s*void/g);
});
