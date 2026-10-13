'use strict';
// #1631: the routing details popover ("Decision service · Code") in the strip under the composer opened
// over the composer and covered the send button, the defect #1628 fixed for the engine-metrics popover.
// It is now placed by the same measurement: StatsBar measures the composer block while the details are
// open and hands the geometry (stats-anchor.ts) to the stylesheet as two custom properties, and the
// routing popover's CSS reads them. The browser proof is qa/routing-popover-1631.cjs (1440, 809, 375 px
// and a short window, send-button rectangle against the popover's); these are the fast checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

function loadPure(relPath) {
  const code = ts.transpileModule(read(relPath), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => ({}) });
  return exports;
}
const { anchorAboveComposer, ANCHOR_GAP, ANCHOR_MIN_HEIGHT } = loadPure('src/stats-anchor.ts');

/** Where the popover lands for a strip bottom edge, a composer top edge and a content height, as the
 *  stylesheet applies the anchor: bottom edge `bottom` px above the strip's bottom, height capped at maxHeight. */
function popoverRect(stripBottom, composerTop, contentHeight) {
  const a = anchorAboveComposer(stripBottom, composerTop);
  const bottomEdge = stripBottom - a.bottom;
  const height = Math.min(contentHeight, a.maxHeight, 420);
  return { top: bottomEdge - height, bottom: bottomEdge };
}

test('the popover ends above the composer block at desktop, narrow and short windows, whatever the composer height (#1631)', () => {
  // [window height, composer top, strip bottom]: the strip is directly under the composer, which grows
  // taller when it wraps at narrow widths or holds attachments.
  for (const [innerHeight, composerTop] of [[900, 760], [900, 620], [812, 640], [600, 470], [500, 380]]) {
    const stripBottom = innerHeight - 4;
    const rect = popoverRect(stripBottom, composerTop, 600);
    assert.ok(rect.bottom <= composerTop - ANCHOR_GAP + 1, `window ${innerHeight}: popover bottom ${rect.bottom} clears composer top ${composerTop}`);
    assert.ok(rect.top >= 0, `window ${innerHeight}: popover top ${rect.top} stays inside the window`);
  }
});

test('with little room above the composer the popover keeps its floor height and scrolls (#1631)', () => {
  assert.equal(anchorAboveComposer(600, 100).maxHeight, ANCHOR_MIN_HEIGHT);
  assert.equal(anchorAboveComposer(600, 500).maxHeight, 500 - ANCHOR_GAP * 2);
});

test('the strip passes the routing popover\'s open state to the measurement, except in the model sheet (#1631)', () => {
  const stats = read('src/components/StatsBar.tsx');
  assert.match(stats, /const \[routingOpen, setRoutingOpen\] = useState\(false\);/);
  assert.match(stats, /useEffect\(\(\) => \{ if \(!routingDecision\) setRoutingOpen\(false\); \}, \[routingDecision\]\);/);
  assert.match(stats, /const anchored = moreOpen \|\| \(routingOpen && variant !== 'sheet'\);/, 'the sheet lays the details out in flow');
  assert.match(stats, /if \(!anchored\) \{ setMoreAnchor\(null\); return undefined; \}/);
  assert.match(stats, /\}, \[anchored\]\);/);
  assert.equal((stats.match(/<RoutingDetails decision=\{routingDecision\} onOpenChange=\{setRoutingOpen\} \/>/g) || []).length, 2, 'both the wide and the narrow strip');
  assert.equal((stats.match(/style=\{anchorStyle\}/g) || []).length, 2, 'the wide and the narrow strip both carry the anchor');
  assert.match(stats, /const anchorStyle = anchored && moreAnchor \? \{ '--stats-more-bottom': `\$\{moreAnchor\.bottom\}px`, '--stats-more-max': `\$\{moreAnchor\.maxHeight\}px` \}/);
});

test('RoutingDetails reports its open state, and a reply\'s own details in the transcript do not need it (#1631)', () => {
  const chat = read('src/components/ChatView.tsx');
  assert.match(chat, /export function RoutingDetails\(\{ decision, onOpenChange \}: \{ decision: RoutingDecision; onOpenChange\?: \(open: boolean\) => void \}\)/);
  assert.match(chat, /<details className="thinking-block routing-details" onToggle=\{onOpenChange \? event => onOpenChange\(event\.currentTarget\.open\) : undefined\}>/);
  assert.match(chat, /\{m\.routingDecision && <RoutingDetails decision=\{m\.routingDecision\} \/>\}/);
});

test('the open routing popover is placed by the measured anchor and scrolls within its room, not flush with the strip bottom (#1631)', () => {
  const css = read('src/styles/noevia.css');
  const start = css.indexOf('.stats-disclosure > .routing-details[open], .stats-disclosure.is-wide > .routing-details[open] {');
  const rule = css.slice(start, css.indexOf('}', start));
  assert.match(rule, /position: absolute;/, 'out of flow, so the composer does not move');
  assert.match(rule, /bottom: var\(--stats-more-bottom, calc\(100% \+ var\(--space-2\)\)\);/);
  assert.doesNotMatch(rule, /bottom: 0;/, 'the old anchor put the panel over the composer');
  assert.match(rule, /max-height: min\(60vh, 420px, var\(--stats-more-max, 100vh\)\);/);
  assert.match(rule, /overflow: auto;/);
  // The narrow rule only widens it; it must not move the bottom edge back.
  const narrow = css.slice(css.indexOf('@media (max-width: 700px) {', start), css.indexOf('/* Diary breadcrumb', start));
  assert.doesNotMatch(narrow, /bottom:/);
  // The model sheet keeps its in-flow layout.
  assert.match(read('src/styles/space-tiers.css'), /\.mp-status \.stats-disclosure\.is-sheet > \.routing-details\[open\] \{\s*position: static;/);
});
