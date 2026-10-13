// #1541: the Diary header sits in the same column as the content below it. A layout test without a browser:
// it pins the CSS rules the fix depends on, so a later edit cannot quietly undo them. The measured alignment
// in pixels still needs a live check after review.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');

// The declaration block text of the first rule whose selector starts with `selector`.
function block(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `no rule for ${selector}`);
  const open = source.indexOf('{', start), close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

test('the header and the content take their side inset from one variable', () => {
  assert.match(block(css, '.diary-workspace {'), /--diary-inset: var\(--diary-gutter\)/, 'the base inset is the gutter the content used');
  const header = block(css, '.diary-header {');
  assert.match(header, /padding-left: max\(var\(--diary-inset\), calc\(\(100% - 820px\) \/ 2\)\)/, 'the left edge follows the inset, or the 820px column when wider');
  assert.match(header, /padding-right: max\(var\(--diary-inset\), calc\(\(100% - 820px\) \/ 2\)\)/, 'and so does the right edge');
  assert.match(block(css, '.diary-content-scroll {'), /padding: 32px var\(--diary-inset\)/);
  assert.match(block(css, '.diary-composer-dock {'), /padding: 8px var\(--diary-inset\) 12px/);
});

test('at 1000px and in the phone layout the inset is 16px for the header, the content and the composer', () => {
  const narrow = css.slice(css.indexOf('@media (max-width: 1000px) {'));
  assert.match(narrow, /\.diary-workspace \{ --diary-inset: 16px; \}/);
  assert.match(narrow, /\.diary-content-scroll \{ padding: 20px var\(--diary-inset\); \}/);
  assert.match(css, /:root\[data-layout="mobile"\] \.diary-workspace \{ --diary-inset: 16px; \}/);
  // The mobile header's 60px clearance for the nav toggle still wins over the column rule.
  assert.match(css, /\.chat-header, \.diary-header, \.coding-header \{ padding-left: 60px; \}/);
});

test('the calendar column is the same 820px the header now uses', () => {
  assert.match(block(css, '.diary-calendar-section {'), /max-width:820px/);
});
