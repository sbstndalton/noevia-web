'use strict';
// #1538: Settings > Usage > Activity opened scrolled to the oldest months, so the latest weeks (Aug to
// Oct) sat past the right edge of a 509 px box. The heat map now opens at its right-hand end.
// revealLatestWeeks is pure and tested directly; UsageView is checked for wiring (its data arrives
// through effects, which react-dom/server never runs, so the page itself is not rendered here).
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./settings-catalogue-b4.cjs');

const { revealLatestWeeks } = load('usage-heatmap-scroll');

test('a grid wider than its box opens at the right-hand end, where the latest weeks are', () => {
  // The reported layout: about 694 px of grid in a 509 px box, starting at the left.
  const box = { scrollLeft: 0, scrollWidth: 694, clientWidth: 509 };
  revealLatestWeeks(box);
  assert.equal(box.scrollLeft, 694 - 509, 'the box is scrolled to its maximum, so the last column is in view');
  assert.equal(box.scrollLeft + box.clientWidth, box.scrollWidth, 'the right edge of the grid is the right edge of the box');
});

test('a grid that already fits is not scrolled at all', () => {
  const box = { scrollLeft: 0, scrollWidth: 300, clientWidth: 509 };
  revealLatestWeeks(box);
  assert.equal(box.scrollLeft, 0);
});

test('UsageView keeps a ref on the heat map box and reveals the latest weeks after the data arrives', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/UsageView.tsx'), 'utf8');
  assert.match(src, /const heatmapScroll = useRef<HTMLDivElement>\(null\);/);
  assert.match(src, /<div className="usage-heatmap-scroll" ref=\{heatmapScroll\}>/);
  assert.match(src, /useLayoutEffect\(\(\) => \{ if \(heatmapScroll\.current\) revealLatestWeeks\(heatmapScroll\.current\); \}, \[data\]\);/);
});
