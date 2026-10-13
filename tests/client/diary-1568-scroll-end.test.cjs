// #1568: the Diary's scroll area ends with clear space and a fade, so the last calendar row or list row is never
// cut off against the composer. Source contracts; the pixels need a live check after review.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the scroll area ends with a spacer before the composer dock', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryView.tsx'), 'utf8');
  assert.match(src, /<div className="diary-scroll-end" aria-hidden="true" \/>\n      <\/div>\n      <div className="diary-composer-dock">/);
});

test('the scroll area fades its bottom 24px, the same height as the spacer', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');
  assert.match(css, /\.diary-scroll-end \{ height: 24px; \}/);
  assert.match(css, /\.diary-content-scroll \{[^}]*mask-image: linear-gradient\(to bottom, #000 calc\(100% - 24px\), transparent\)/);
});
