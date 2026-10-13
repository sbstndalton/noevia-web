'use strict';
// #1462: Settings > Usage put "Retained history" on the same numbers as "last 30 days" and used
// internal wording ("Companion-only Diary generation", "Diary tool preparation") in the intro. Each
// figure now names its own window: the Total card carries the period the header shows, and the
// lists that ignore the period buttons say "all retained history" and say so.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS_LOCALES, catalogues } = require('./settings-catalogue-b4.cjs');

const SETTINGS = catalogues(SETTINGS_LOCALES);
const EN = SETTINGS['en-GB'];

test('the intro uses plain words for what is counted and what is not', () => {
  assert.ok(!/Companion-only|tool preparation|omit usage/.test(EN['usage.intro']), EN['usage.intro']);
  assert.match(EN['usage.intro'], /Diary assistant steps that use a tool/);
  assert.match(EN['usage.intro'], /providers that do not report usage, are not counted/);
});

test('the all-time figures are captioned "all retained history", the same words as their toggle', () => {
  assert.equal(EN['usage.retainedHistory'], 'All retained history', 'the all-time period button');
  assert.equal(EN['usage.retainedHistoryLower'], 'all retained history', 'the header reads "Tokens · all retained history"');
  assert.match(EN['usage.byModelIntro'], /^All retained history, busiest first\./);
  assert.match(EN['usage.byModelIntro'], /period buttons do not change this list/, 'the by-model list says the period buttons do not move it');
  assert.match(EN['usage.toolsIntro'], /across all retained history/);
  assert.equal(EN['usage.favouriteModelHint'], '{tokens} tokens, all retained history.');
  assert.equal(EN['usage.responsesRetained'], 'Responses · all retained history');
});

test('the Total card carries the window the header shows, in every locale', () => {
  assert.equal(EN['usage.totalHint'], 'Input and output, {window}.');
  for (const [locale, catalogue] of Object.entries(SETTINGS)) {
    assert.match(catalogue['usage.totalHint'], /\{window\}/, `${locale} totalHint takes the window`);
    if (locale !== 'en-GB') assert.notEqual(catalogue['usage.totalHint'], EN['usage.totalHint'], `${locale} is translated`);
  }
});

test('every locale has its own wording for the changed captions, not the English copy', () => {
  for (const [locale, catalogue] of Object.entries(SETTINGS)) {
    if (locale === 'en-GB') continue;
    for (const key of ['usage.intro', 'usage.retainedHistory', 'usage.retainedHistoryLower', 'usage.toolsIntro', 'usage.byModelIntro', 'usage.favouriteModelHint', 'usage.responsesRetained']) {
      assert.notEqual(catalogue[key], EN[key], `${locale} ${key} is translated`);
    }
  }
});

test('UsageView passes the window label to the Total card hint', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/UsageView.tsx'), 'utf8');
  assert.match(src, /t\('usage\.totalHint', \{ window: label \}\)/);
});
