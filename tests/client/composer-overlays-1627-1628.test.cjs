'use strict';
// #1627 + #1628 (and #1527): the composer's two overlays. The browser proof is qa/composer-overlays-1627-1628.cjs;
// these are the fast checks that pin the pieces it relies on.
//  - anchorAboveComposer (stats-anchor.ts) is the geometry: the metrics popover ends above the composer block.
//  - StatsBar measures the composer and hands that geometry to the stylesheet as two custom properties.
//  - phone.css reads those properties (with the old default), so the popover never sits over the composer.
//  - overlays.css makes the + menu's entrance fully opaque (#1627), so page text cannot print through it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

function loadPure(relPath) {
  const code = ts.transpileModule(read(relPath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => ({}) });
  return exports;
}

const { anchorAboveComposer, ANCHOR_GAP, ANCHOR_MIN_HEIGHT } = loadPure('src/stats-anchor.ts');

test('the popover ends ANCHOR_GAP above the composer block, measured from the strip bottom (#1628)', () => {
  // Strip bottom at 900, composer block top at 600: its bottom edge sits 8px above 600.
  const a = anchorAboveComposer(900, 600);
  assert.equal(a.bottom, 900 - 600 + ANCHOR_GAP);
  assert.equal(a.maxHeight, 600 - ANCHOR_GAP * 2);
  assert.equal(ANCHOR_GAP, 8);
});

test('the popover may be no taller than the room above the composer, with a floor so it stays usable (#1628)', () => {
  assert.equal(anchorAboveComposer(900, 40).maxHeight, ANCHOR_MIN_HEIGHT, 'a composer near the top keeps the floor');
  assert.equal(anchorAboveComposer(900, 700).maxHeight, 700 - ANCHOR_GAP * 2);
});

test('the bottom offset never goes negative and non-finite input keeps the stylesheet default (#1628)', () => {
  assert.equal(anchorAboveComposer(500, 600).bottom, 0, 'a composer below the strip edge clamps to 0');
  assert.equal(anchorAboveComposer(NaN, 600), null);
  assert.equal(anchorAboveComposer(900, Infinity), null);
});

test('StatsBar measures the composer block and sets the two custom properties only while the wide popover is open', () => {
  const src = read('src/components/StatsBar.tsx');
  assert.match(src, /import \{ anchorAboveComposer, type AnchorAbove \} from '\.\.\/stats-anchor';/);
  assert.match(src, /document\.querySelector<HTMLElement>\('\.chat-composer-inner'\)\?\.closest<HTMLElement>\('\.composer'\)/, 'the composer block is the .composer that holds the box');
  assert.match(src, /setMoreAnchor\(previous => \(previous\?\.bottom === next\?\.bottom && previous\?\.maxHeight === next\?\.maxHeight \? previous : next\)\);/);
  assert.match(src, /window\.addEventListener\('resize', place\);/);
  assert.match(src, /new ResizeObserver\(place\)/);
  assert.match(src, /style=\{moreOpen && moreAnchor \? \{ '--stats-more-bottom': `\$\{moreAnchor\.bottom\}px`, '--stats-more-max': `\$\{moreAnchor\.maxHeight\}px` \} as CSSProperties : undefined\}/);
});

test('the wide metrics popover is out of flow and ends at the measured anchor, scrolling inside its room (#1628)', () => {
  const phone = read('src/styles/phone.css');
  const block = phone.slice(phone.indexOf('.stats-disclosure.is-wide.is-more-open .stats-details {'));
  const rule = block.slice(0, block.indexOf('}'));
  assert.match(rule, /position: absolute;/, 'out of flow, so the composer does not move (#1548)');
  assert.match(rule, /bottom: var\(--stats-more-bottom, calc\(100% \+ var\(--space-2\)\)\);/, 'the measured anchor, with the old default kept');
  assert.match(rule, /max-height: var\(--stats-more-max, none\);/);
  assert.match(rule, /overflow-y: auto;/);
});

test('the + menu enters fully opaque, so the page text under it cannot show through (#1627)', () => {
  const css = read('src/styles/overlays.css');
  assert.match(css, /\.composer-actions-panel \{ --enter-opacity: 1; \}/);
  // The travel and the entrance keyframe are unchanged: it still rises into place, it just does not fade.
  assert.match(css, /\.overlay:is\(\.ctx-menu, \.account-popover, \.composer-actions-panel\) \{\s*transform-origin: top left;\s*--enter-from: translateY\(-4px\) scale\(\.98\);\s*animation: motion-enter var\(--motion-quick\) var\(--ease-quick\) both;\s*\}/);
});

test('the + menu is entered by a scale-only Motion kind, so its spring never fades it (#1627)', () => {
  const motion = read('src/motion/index.ts');
  // The Motion layer animates every added menu; the composer panel must not get the menu kind (opacity 0 -> 1).
  assert.match(motion, /panel: \{ from: \{ scale: 0\.97 \}, to: \{ scale: 1 \} \},/);
  assert.match(motion, /panel: \{ type: 'spring', bounce: 0, visualDuration: 0\.14 \},/);
  assert.match(motion, /void enter\(node, node\.matches\('\.composer-actions-panel'\) \? 'panel' : 'menu'\);/);
  assert.match(motion, /export type MotionKind = 'dialog' \| 'menu' \| 'panel' \|/);
});

test('the + menu keeps the token fill and elevation it had (#1627)', () => {
  const components = read('src/styles/system/components.css');
  assert.match(components, /\.overlay, \.aero, :is\(\.ctx-menu, \.account-popover, \.popup, \.composer-actions-panel, [^{]*\) \{\s*background: var\(--surface-overlay\);/);
  assert.match(components, /box-shadow: var\(--ring-inset\), var\(--shadow-popover\);/);
});
