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

test('a hyphen between letters is also kept with its next character', () => {
  assert.equal(keepIdentifiersWhole('well-known'), `well-${WJ}known`);
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
