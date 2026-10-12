'use strict';
// #1542: a hyphen between two letters or digits gets a word joiner after it, so an identifier such as
// "20261012-0610" never breaks across lines. Only the display text changes; the rest is left alone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keepIdentifiersWhole } = require('../../src/no-break-identifiers.ts');

const WJ = '⁠';
const visible = (s) => s.replace(/⁠/g, '');

test('a hyphen inside a numeric identifier cannot end a line', () => {
  const out = keepIdentifiersWhole('QA Haiku 20261012-0610 renamed');
  assert.equal(out, `QA Haiku 20261012-${WJ}0610 renamed`);
  assert.equal(visible(out), 'QA Haiku 20261012-0610 renamed', 'the text reads the same once the joiner is ignored');
});

test('a hyphen next to a digit is kept with its next character, wherever the digit sits', () => {
  assert.equal(keepIdentifiersWhole('v2-release'), `v2-${WJ}release`, 'digit before the hyphen');
  assert.equal(keepIdentifiersWhole('release-2'), `release-${WJ}2`, 'digit after the hyphen');
  assert.equal(keepIdentifiersWhole('proj-2026-identifier'), `proj-${WJ}2026-${WJ}identifier`, 'both hyphens touch the number, so both stay with it');
});

test('plain hyphenated words keep their hyphen breaks, so a long name wraps between words and not inside one', () => {
  // #1542 QA: joining every letter-to-letter hyphen made the whole name one unbreakable word, which then
  // broke mid-word ("identifi/er", "na/me") at 849 px and 390 px.
  assert.equal(keepIdentifiersWhole('well-known'), 'well-known');
  assert.equal(keepIdentifiersWhole('proj-synthetic-identifier-long-hyphenated-name'), 'proj-synthetic-identifier-long-hyphenated-name');
});

test('hyphens not between two word characters are left alone, so names still wrap at spaces and dashes', () => {
  for (const s of ['a - b', '-leading', 'trailing-', 'x--y', 'noevia projects/QA Haiku 20261012-0610/Documents']) {
    assert.equal(visible(keepIdentifiersWhole(s)), s, s);
  }
  assert.equal(keepIdentifiersWhole('a - b'), 'a - b', 'a spaced dash gets no joiner');
});

test('names without a hyphen are returned unchanged, and the function is pure', () => {
  assert.equal(keepIdentifiersWhole('Plain name'), 'Plain name');
  assert.equal(keepIdentifiersWhole(''), '');
  const input = 'QA-1';
  keepIdentifiersWhole(input);
  assert.equal(input, 'QA-1');
});
