'use strict';
// sbstndalton/noevia#2397: the reranker switch shows what is in effect, so it cannot read On beside an Off pill. Browser
// proof: qa/reranker-switch-2397.cjs (the repo renders no components in node tests; the wiring is pinned from source).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/models/ServiceAssignments.tsx'), 'utf8');

test('noevia#2397 the switch is checked from the effective state, the same one the pill reads', () => {
  assert.match(src, /const effectiveOn = svc\.enabled === true && pillState\(svc, health\) !== 'off';/);
  assert.match(src, /checked=\{effectiveOn\}/);
  assert.doesNotMatch(src, /checked=\{svc\.enabled === true\}/);
  assert.match(src, /disabled=\{busy !== '' \|\| \(!current && !effectiveOn\)\}/, 'disabled while there is nothing to switch on');
});

test('noevia#2397 the stored flag still decides what the model picker saves, and the source hint stays', () => {
  assert.match(src, /saveReranker\(svc\.enabled === true, id\)/);
  assert.match(src, /mm\.assign\.rerankerFromDeployment/);
});
