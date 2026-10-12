'use strict';
// #1554: Escape closes the composer's "Add files and tools" popover and returns focus to the + button,
// wherever focus is. ComposerActions.tsx is a React component, so this is a source-contract check on
// the document-level Escape listener, which only exists while the menu is open.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ComposerActions.tsx'), 'utf8');

test('an open Add files and tools menu listens for Escape on the document and closes itself (#1554)', () => {
  const start = src.indexOf('// #1554: Escape closes the menu');
  assert.ok(start > 0, 'listener present');
  const block = src.slice(start, start + 800);
  assert.match(block, /if \(!open\) return;/);
  assert.match(block, /document\.addEventListener\('keydown', onEscape\);/);
  assert.match(block, /if \(event\.key !== 'Escape' \|\| event\.defaultPrevented\) return;/);
  assert.match(block, /setOpen\(false\);\s*\n\s*trigger\.current\?\.focus\(\);/);
  assert.match(block, /return \(\) => document\.removeEventListener\('keydown', onEscape\);/);
});

test('the root Escape handler that returns focus to the + button is kept (#1554)', () => {
  assert.match(src, /if \(event\.key === 'Escape'\) \{ event\.stopPropagation\(\); setOpen\(false\); trigger\.current\?\.focus\(\); \}/);
});
