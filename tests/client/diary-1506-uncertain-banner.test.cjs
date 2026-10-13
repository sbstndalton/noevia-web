// #1506: the Diary's uncertain-save banner always offers "Put the message back in the composer" (not only when
// one exchange is uncertain), and names the time for several exchanges too. Source contracts; synthetic data only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');

test('"put back in the composer" is offered for one uncertain exchange or several', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/DiaryView.tsx'), 'utf8');
  assert.doesNotMatch(src, /uncertain\.length === 1 && <button/, 'the action is still gated on a single exchange');
  assert.match(src, /onClick=\{\(\) => void reuseUncertain\(uncertain\[0\]\)\}>\{t\('diary\.uncertain\.reuse'\)\}/);
});

test('the banner\'s time is the earliest of the listed exchanges, for one or several', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/DiaryView.tsx'), 'utf8');
  assert.match(src, /time: new Date\(Math\.min\(\.\.\.uncertain\.map\(x => x\.startedAt\)\)\)\.toLocaleTimeString/);
});

test('every locale\'s plural banner names the count, the day and the time', () => {
  const dir = path.join(SRC, 'i18n/diary');
  // en-US is an empty catalogue that falls back to en-GB, so it has no strings of its own to check.
  const files = fs.readdirSync(dir).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts');
  assert.ok(files.length >= 8, `expected the locale catalogues, found ${files.length}`);
  for (const file of files) {
    const line = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').find((l) => l.includes("'diary.uncertain.banner.other'"));
    assert.ok(line, `${file} has no banner.other string`);
    for (const placeholder of ['{count}', '{day}', '{time}']) assert.ok(line.includes(placeholder), `${file} banner.other lacks ${placeholder}`);
  }
});
