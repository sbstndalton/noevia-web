'use strict';
// #1468: the chat Links popover stays inside the viewport. linksPanelLeft is pure and unit-tested
// here; ChatLinks.tsx is checked for the wiring (placed before paint, then on resize).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/links-panel-place.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exports_ });
const { linksPanelLeft } = exports_;
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ChatLinks.tsx'), 'utf8');

test('a panel anchored at the trigger keeps its right-aligned spot when it fits (#1468)', () => {
  // 431 px phone, trigger right edge at 400, 320 px panel: right-aligned left edge is 80, inside the gutters.
  assert.equal(linksPanelLeft({ anchorRight: 400, panelWidth: 320, viewportWidth: 431 }), 80);
});

test('a panel that would run off the left edge stops at the 16 px gutter (#1468)', () => {
  // The reported case: the trigger sits at x=239 on a 431 px phone and the panel started at -57.
  assert.equal(linksPanelLeft({ anchorRight: 239, panelWidth: 296, viewportWidth: 431 }), 16);
  assert.equal(linksPanelLeft({ anchorRight: 100, panelWidth: 320, viewportWidth: 431 }), 16);
});

test('a panel that would run off the right edge is pulled back inside the right gutter (#1468)', () => {
  assert.equal(linksPanelLeft({ anchorRight: 470, panelWidth: 320, viewportWidth: 431 }), 431 - 16 - 320);
});

test('a panel wider than the viewport lines up with the left gutter, not off it (#1468)', () => {
  assert.equal(linksPanelLeft({ anchorRight: 300, panelWidth: 500, viewportWidth: 431 }), 16);
});

test('ChatLinks places the panel before paint and again on resize, clamped to the viewport (#1468)', () => {
  assert.match(src, /import \{ useEffect, useLayoutEffect, useMemo, useRef, useState \} from 'react';/);
  assert.match(src, /import \{ linksPanelLeft \} from '\.\.\/links-panel-place';/);
  const block = src.slice(src.indexOf('useLayoutEffect(() => {\n    if (!open)'), src.indexOf('useLayoutEffect(() => {\n    if (!open)') + 700);
  assert.match(block, /linksPanelLeft\(\{ anchorRight: anchor\.getBoundingClientRect\(\)\.right, panelWidth: popover\.getBoundingClientRect\(\)\.width, viewportWidth: window\.innerWidth \}\)/);
  assert.match(block, /setPanelOffset\(left - frame\.getBoundingClientRect\(\)\.left\);/);
  assert.match(block, /window\.addEventListener\('resize', place\);/);
  assert.match(block, /return \(\) => window\.removeEventListener\('resize', place\);/);
  assert.match(src, /style=\{panelOffset === null \? undefined : \{ left: panelOffset, right: 'auto' \}\}/);
});
