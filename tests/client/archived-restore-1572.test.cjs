'use strict';
// #1572: on archived project cards "Restore" sat inline with the chips on one card and dropped to its
// own line on others, because it lived in the wrapping .project-card-meta row. It is in a footer row
// of its own on every archived card, so it sits in the same place across the grid.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectsView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../src/styles/app.css'), 'utf8');

test('Restore is not part of the wrapping chip row', () => {
  const start = src.indexOf('<div className="project-card-meta">');
  const end = src.indexOf('#1572: Restore has a footer row');
  assert.ok(start > 0 && end > start, 'expected the card meta row, followed by the footer');
  assert.doesNotMatch(src.slice(start, end), /t\('projects\.restore'\)/, 'the chip row no longer holds Restore');
});

test('Restore sits in one footer row, after the chips, on every archived card', () => {
  const footer = src.match(/\{p\.archived && \(\s*<div className="project-card-foot">\s*<button[\s\S]*?t\('projects\.restore'\)[\s\S]*?<\/button>\s*<\/div>\s*\)\}/);
  assert.ok(footer, 'an archived-only footer row holds the Restore button');
  assert.match(footer[0], /onPatch\(p\.id, \{ archived: false \}\)/);
});

test('the footer row is laid out at the end of the card, on its own line', () => {
  assert.match(css, /\.project-card-foot\s*\{[^}]*justify-content:\s*flex-end/);
});
