'use strict';
// #1527 + #1548: the inference strip under the composer is one row (wide variant), the lower-priority
// pairs open from a compact toggle, and the row reserves its height. The browser proof is
// qa/strip-layout-1527.cjs; this file pins the contract that proof depends on, so a refactor that
// drops a hook fails here before it reaches the browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8');
const phone = read('styles/phone.css');
const statsBar = read('components/StatsBar.tsx');

// The wide variant's rules: from its first selector up to the phone-width block that follows them.
function wideBlock() {
  const start = phone.indexOf('.stats-disclosure.is-wide {');
  const end = phone.indexOf('@media (max-width: 700px) {', start);
  assert.ok(start > 0 && end > start, 'the wide strip rules are in phone.css, before the 700px block');
  return phone.slice(start, end);
}

test('#1527: the wide strip is one row that never wraps, and is its own width container', () => {
  const block = wideBlock();
  assert.match(block, /\.stats-disclosure\.is-wide \{[^}]*flex-wrap: nowrap;/);
  assert.match(block, /\.stats-disclosure\.is-wide \{[^}]*container-type: inline-size;/);
  assert.doesNotMatch(block, /flex-wrap: wrap/, 'no wrapping rule anywhere in the wide strip');
  assert.doesNotMatch(block, /clip-path: inset/, 'the clip-path that hid a wrapped dot is gone with the wrap');
});

test('#1527: nothing in the wide strip is a fixed width that assumes one window size', () => {
  const block = wideBlock();
  // The popover's width is a cap, not a size; the row itself is sized by its container.
  assert.doesNotMatch(block, /\.stats-details \{[^}]*width: \d+px/);
  assert.doesNotMatch(block, /\.stats-bar-static \{[^}]*width: \d+px/);
});

test('#1527: the model name keeps its width and the route pill gives way first, with its own ellipsis', () => {
  // 2026-10-12 local QA: at 790px the static label shrank to 'Synthetic-Ch…' while the routing pill kept its width.
  // The label now holds its natural width, the speed pair is whole, and the pill is the element that yields.
  const block = wideBlock();
  assert.match(block, /\.stats-bar-static \{[^}]*flex: 0 0 auto;/);
  assert.match(block, /\.stats-bar-static \.stats-label \{[^}]*text-overflow: ellipsis;/);
  assert.match(block, /\.stats-details dd \{[^}]*text-overflow: ellipsis;/);
  assert.match(block, /\.stats-details > div\[data-priority='high'\] \{ flex: none; \}/);
  assert.match(block, /\.stats-disclosure\.is-wide > \.routing-details:not\(\[open\]\) \{ flex: 0 1 auto; min-width: 0;/);
});

test('#1527: the compact toggle is hidden where every pair fits, and it opens an aligned popover', () => {
  const block = wideBlock();
  assert.match(block, /\.stats-disclosure\.is-wide \.stats-more \{ display: none; \}/);
  assert.match(block, /@container \(max-width: 1479px\) \{/);
  assert.match(block, /\.stats-disclosure\.is-wide\.is-more-open \.stats-details \{[^}]*position: absolute;[^}]*grid-template-columns: max-content minmax\(0, 1fr\);/);
  assert.match(block, /\.stats-disclosure\.is-wide\.is-more-open \.stats-details > div\[data-stat\] \{ display: contents; \}/);
});

test('#1527: StatsBar tags each pair with a priority and wires the toggle to the details', () => {
  for (const [stat, priority] of [['speed', 'high'], ['first-token', 'low'], ['reply', 'low'], ['total', 'low'], ['gpu', 'low'], ['mtp', 'low']]) {
    assert.ok(statsBar.includes(`data-stat="${stat}" data-priority="${priority}"`) || statsBar.includes(`data-stat="${stat}" data-priority="${priority}" key=`), `${stat} is ${priority}`);
  }
  assert.match(statsBar, /className="stats-more" aria-expanded=\{moreOpen\} aria-controls="stats-details"/);
  assert.match(statsBar, /className=\{`stats-disclosure is-open is-wide\$\{moreOpen \? ' is-more-open' : ''\}`\}/);
});

test('#1527: the toggle reuses the existing show/hide copy, so no new translation key is needed', () => {
  assert.match(statsBar, /aria-label=\{moreOpen \? t\('stats\.hide'\) : t\('stats\.show'\)\}/);
  assert.ok(read('i18n/en-GB.ts').includes("'stats.show': 'Show inference details'"));
});

test('#1548: the wide row reserves its height, so the composer above it does not move', () => {
  const block = wideBlock();
  assert.match(block, /\.stats-disclosure\.is-wide \{[^}]*min-height: 36px;/);
  assert.match(block, /\.stats-disclosure\.is-wide \.stats-bar-static \{[^}]*min-height: 0;/, 'the static line does not add its own height');
});
