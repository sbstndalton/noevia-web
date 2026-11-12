'use strict';
// sbstndalton/noevia#2486: the Space, page and coworker headings take focus on a route change without drawing a ring unless the
// keyboard was the last input. Browser proof: qa/heading-focus-2486.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

test('noevia#2486 the three headings are focused through focusHeading', () => {
  assert.match(read('src/components/spaces/SpacePages.tsx'), /focusHeading\(heading\.current\)/);
  assert.match(read('src/components/spaces/PageEditor.tsx'), /else focusHeading\(heading\.current\)/);
  assert.match(read('src/components/coworkers/CoworkerHeader.tsx'), /focusHeading\(heading\.current\)/);
});

test('noevia#2486 focusHeading is quiet after a pointer or none, loud after a key, and the CSS beats the global ring', () => {
  const src = read('src/quiet-focus.ts');
  assert.match(src, /addEventListener\('keydown', \(\) => \{ keyboardLast = true; \}, true\)/);
  assert.match(src, /addEventListener\('pointerdown', \(\) => \{ keyboardLast = false; \}, true\)/);
  assert.match(src, /if \(!keyboardLast\) \{\s*el\.dataset\.quietFocus = '';/);
  assert.match(src, /el\.addEventListener\('keydown', loud\);\s*el\.addEventListener\('blur', loud\);/);
  assert.match(read('src/styles/shell-v2.css'), /^\[data-quiet-focus\]:focus-visible \{ outline: none !important; \}$/m);
});

test('noevia#2486 the listeners are installed at startup, not with the lazy Spaces and Coworkers chunks', () => {
  assert.match(read('src/main.tsx'), /^import '\.\/quiet-focus';$/m);
});
