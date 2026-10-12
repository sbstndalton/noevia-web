'use strict';
// #1539: Settings > Usage put the period buttons (7 days / 30 days / All retained history) on a row of
// their own above the heading they control, and the four totals tiles laid out 3 + 1. The buttons now
// stay on the section's title row, and the four tiles fill their row evenly (two rows of two in a
// narrow section). Source-level checks: the markup and the rules that decide the layout. No browser.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const usage = fs.readFileSync(path.join(root, 'src/components/UsageView.tsx'), 'utf8');

const declarationsOf = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `app.css declares ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

test('the period buttons are in the same header as the section title they control', () => {
  // The tokens section head holds the title block and then the period group, in that order.
  assert.match(usage, /<div className="usage-section-head">\s*<div><h2>\{t\('usage\.tokens', \{ window: label \}\)\}<\/h2><p>\{t\('usage\.tokensIntro'\)\}<\/p><\/div>\s*<div className="usage-window" role="group" aria-label=\{t\('usage\.timeWindow'\)\}>/);
});

test('the header keeps the buttons on the title row; only a narrow screen stacks them', () => {
  assert.match(declarationsOf(app, '.usage-section-head'), /flex-wrap: nowrap/);
  assert.match(declarationsOf(app, '.usage-section-head > div:first-child'), /min-width: 0/, 'the title gives way first');
  assert.match(declarationsOf(app, '.usage-section-head > .usage-window'), /flex: none/, 'the buttons keep their width');
  assert.match(app, /@media \(max-width: 519px\) \{\s*\.usage-section-head \{ flex-wrap: wrap; \}/);
});

test('the totals grid is the four-tile grid, and it fills its rows evenly', () => {
  assert.match(usage, /<div className="usage-stat-grid usage-stat-grid--four">\s*<Stat label=\{t\('usage\.total'\)\}/);
  assert.match(declarationsOf(app, '.usage-stat-grid--four'), /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(app, /@container \(max-width: 560px\) \{ \.usage-stat-grid--four \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
  assert.match(app, /\.usage-section \{ container-type: inline-size; \}/, 'the narrow case is measured on the section');
});
