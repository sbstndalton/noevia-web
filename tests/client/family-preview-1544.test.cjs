'use strict';
// #1544: Settings > Appearance > Theme family shows a live mock composer; its placeholder "Message
// noevia…" broke onto two lines in both previews. The placeholder now sits in its own single-line
// element that clips with an ellipsis, and the composer may shrink to fit the tile. Source-level
// checks only (no browser in this batch): the markup and the rules that decide the layout.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'src/styles/system/components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const general = fs.readFileSync(path.join(root, 'src/components/GeneralSettings.tsx'), 'utf8');

const ruleOf = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `components.css declares ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

test('the mock composer puts the placeholder in its own single-line element', () => {
  assert.match(general, /<span className="family-preview-composer"><span className="family-preview-composer-text">\{t\('composer\.placeholder'\)\}<\/span><i className="family-preview-send" \/><\/span>/);
});

test('that element never wraps and clips with an ellipsis', () => {
  const rule = ruleOf('.family-preview-composer-text');
  assert.match(rule, /white-space: nowrap/);
  assert.match(rule, /text-overflow: ellipsis/);
  assert.match(rule, /overflow: hidden/);
  assert.match(rule, /min-width: 0/);
});

test('the composer may shrink below its text, so the menu beside it cannot push the text onto two lines', () => {
  assert.match(ruleOf('.family-preview-composer'), /min-width: 0/);
});
