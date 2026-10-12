'use strict';
// #1470: Cmd+K opens the navigation drawer at phone width and focuses the search field. The effect
// that focuses the drawer's close button on open must not steal focus from a search-led open, and
// the ⌘K event must focus the field even when the drawer was already open (autoFocus only runs on
// mount). Source-contract checks on Sidebar.tsx, as in sidebar-focus-and-undo.test.cjs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');

test('⌘K / Ctrl+K focuses the search field after opening the drawer, even if it was already open (#1470)', () => {
  const line = src.split('\n').find((l) => l.includes("addEventListener('noevia:open-search'"));
  assert.ok(line, 'open-search listener present');
  assert.match(line, /setSearching\(true\); window\.requestAnimationFrame\(\(\) => searchInputRef\.current\?\.focus\(\)\);/);
});

test('a search-led drawer open focuses the search field, not the close button (#1470)', () => {
  assert.match(src, /if \(searching && searchInputRef\.current\) searchInputRef\.current\.focus\(\);\s*\n\s*else drawer\.current\?\.querySelector<HTMLElement>\('\.side-expand'\)\?\.focus\(\);/);
});
