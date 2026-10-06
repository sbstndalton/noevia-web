'use strict';
// #862: ModelPopup stays busy only while its onProjectsChanged promise is pending, so every
// call site must hand back its refresh instead of discarding it with `void`. A discarded
// promise brings back the stale-toolbox-list race (a quick second toggle undoing the first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const files = ['App.tsx', 'components/ChatView.tsx', 'components/DiaryView.tsx'];

test('every ModelPopup call site returns its refresh to the popup', () => {
  let sites = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const m of text.matchAll(/<ModelPopup\b[\s\S]*?(?:\/>|<\/ModelPopup>)/g)) {
      sites++;
      const handler = /onProjectsChanged=\{([\s\S]*?)\}\s*(?:\/>|[a-zA-Z]+=|>)/.exec(m[0]);
      assert.ok(handler, `${f}: ModelPopup without onProjectsChanged`);
      assert.doesNotMatch(handler[1], /\bvoid\b/, `${f}: onProjectsChanged discards the refresh promise: ${handler[1]}`);
    }
  }
  assert.ok(sites >= 4, `expected the App, two ChatView and the Diary call sites, found ${sites}`);
});
