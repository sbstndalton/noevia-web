// #1569: the Memory and context folder crumb (and the Markdown workspace rail, which uses the same markup) keeps
// 8px between the current folder and the Up button, and the current folder reads as crumb text.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tab = fs.readFileSync(path.join(__dirname, '../../src/styles/diary-tab.css'), 'utf8');

function block(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `no rule for ${selector}`);
  const open = source.indexOf('{', start), close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

test('the folder crumb has 8px before Up', () => {
  assert.match(block(tab, '.diary-file-breadcrumb {'), /gap:8px/);
});

test('the current folder is styled as crumb text, not as plain unstyled text', () => {
  assert.match(block(tab, '.diary-file-breadcrumb > span {'), /color:var\(--text-primary\)/);
});
