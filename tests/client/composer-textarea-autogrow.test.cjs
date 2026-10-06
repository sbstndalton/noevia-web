'use strict';
// #434: the composer never grew past its 2-row minimum because nothing ever synced the
// textarea's own height to its content — `max-height: 220px` sat there dead. There is no jsdom
// in this repo (see tests/client/chatview-draft-persistence.test.cjs's note), so real layout (scrollHeight
// growing with lines, capping at max-height, shrinking back) is proven in the browser by
// apps/web/qa/composer-434.cjs; this file pins the source-level contract the same way
// tests/client/chatview-edit-actions.test.cjs pins the #355 focus fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ComposerTextarea.tsx'), 'utf8');

test('syncComposerHeight reads the max-height already set by each surface\'s own CSS, rather than a hard-coded number', () => {
  assert.match(src, /function syncComposerHeight\(el: HTMLTextAreaElement\): void \{/);
  assert.match(src, /const max = parseFloat\(getComputedStyle\(el\)\.maxHeight\);/);
  assert.match(src, /el\.style\.height = `\$\{next\}px`;/);
});

test('height resets to auto before measuring, so scrollHeight reflects the new content and shrinking after send is not stuck at the previous (taller) height', () => {
  const fn = src.slice(src.indexOf('function syncComposerHeight'), src.indexOf('}\n\n/**'));
  const autoIdx = fn.indexOf("el.style.height = 'auto';");
  const measureIdx = fn.indexOf('el.scrollHeight');
  assert.ok(autoIdx >= 0 && autoIdx < measureIdx, 'height must be reset to auto before scrollHeight is read');
});

test('content beyond the cap scrolls internally instead of overflowing the box', () => {
  assert.match(src, /el\.style\.overflowY = capped && el\.scrollHeight > max \? 'auto' : 'hidden';/);
});

test('the height sync runs off the `value` prop itself (a useLayoutEffect keyed on [value]), not only the change handler — so a draft restore, an edit-message load, or clearing after send all resize it the same way typing would, with no flash of the old height', () => {
  // #527: also keyed on `rows`, which changes when the window crosses into phone-sized space.
  assert.match(src, /useLayoutEffect\(\(\) => \{\s*if \(innerRef\.current\) syncComposerHeight\(innerRef\.current\);\s*\}, \[value, rest\.rows\]\);/);
});

test('#527: the height re-syncs on window resize, so a tier change (new max-height, one row) never leaves an empty box tall or a long draft clipped', () => {
  assert.match(src, /window\.addEventListener\('resize', resync\);/);
  assert.match(src, /return \(\) => window\.removeEventListener\('resize', resync\);/);
});

test('the component forwards its ref to the underlying textarea, so a caller can manage focus without a second, competing ref', () => {
  assert.match(src, /export const ComposerTextarea = forwardRef<HTMLTextAreaElement,/);
  assert.match(src, /ref=\{\(el\) => \{\s*innerRef\.current = el;\s*if \(typeof forwardedRef === 'function'\) forwardedRef\(el\);\s*else if \(forwardedRef\) forwardedRef\.current = el;\s*\}\}/);
});
