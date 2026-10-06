// Regression found in review of #345: a mouse press on a catalogue row (a non-focusable <li>)
// blurred the search input with relatedTarget null, which onBlurRoot read as focus leaving the
// panel — closing it (and unmounting the row) before its own click could fire, so choosing a
// tool with the mouse stopped working. No jsdom is installed in this repo, so the panel's
// pure focus-out decision and its mousedown fix are exercised directly, the same technique
// tests/client/menu-focus.test.cjs and tests/client/menu-nav.test.cjs already use.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/tool-catalogue-focus.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const exports_ = {};
vm.runInNewContext(code, { exports: exports_ });
const { shouldClosePanelOnBlur, keepFocusOnMouseDown } = exports_;

const root = (contained) => ({ contains: (n) => n === contained });

test('a blur to somewhere still inside the panel (the input, the trigger) does not close it', () => {
  const input = {};
  assert.equal(shouldClosePanelOnBlur(root(input), input), false);
});

test('a blur to a real outside element, or to nowhere (relatedTarget null), closes the panel', () => {
  const input = {};
  assert.equal(shouldClosePanelOnBlur(root(input), { other: true }), true);
  assert.equal(shouldClosePanelOnBlur(root(input), null), true);
  assert.equal(shouldClosePanelOnBlur(null, null), true);
});

test('a pointer press on a row prevents the mousedown default, so it never blurs the input in the first place', () => {
  let prevented = false;
  keepFocusOnMouseDown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

// The component actually wires the two functions above to the row list and the root's blur,
// rather than reimplementing the logic inline where a future edit could drift from it.
test('ToolCatalogue wires the row list to keepFocusOnMouseDown and the root blur to shouldClosePanelOnBlur', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/ToolCatalogue.tsx'), 'utf8');
  assert.match(src, /<ul[^>]*onMouseDown=\{keepFocusOnMouseDown\}/s, 'the option list must swallow mousedown so a row press cannot blur the search input');
  assert.match(src, /shouldClosePanelOnBlur\(root\.current/, 'onBlurRoot must decide through the shared, tested function');
});
