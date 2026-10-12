'use strict';
// #1570: "Refresh from storage" sat on its own row, away from "Upload files" and "Import text from
// storage", although the column had room for all three. They are one action row now.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectView.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../src/styles/app.css'), 'utf8');

test('the three source actions share one .source-actions row', () => {
  const rows = [...src.matchAll(/<div className="source-actions">([\s\S]*?)\n\s*<\/div>/g)].map((m) => m[1]);
  assert.equal(rows.length, 1, 'one action row, not one per action');
  const row = rows[0];
  assert.match(row, /t\('projects\.view\.refreshFromStorage'\)/);
  assert.match(row, /t\('projects\.view\.uploadFiles'\)/);
  assert.match(row, /t\('projects\.view\.importFromStorage'\)/);
});

test('the action row wraps rather than overflowing a narrow column', () => {
  assert.match(css, /\.source-actions\s*\{[^}]*flex-wrap:\s*wrap/);
});
