// #1452: pressing Enter on a calendar day opens it and keeps keyboard focus in the day (its heading), and leaving
// the day puts focus back on that day's calendar cell. Source contracts; synthetic data only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryView.tsx'), 'utf8');
const navigate = src.slice(src.indexOf('const navigate = '), src.indexOf('const escapeDay'));

test('opening a day moves focus to its heading, which takes programmatic focus', () => {
  assert.match(navigate, /if \(nextDay\) requestAnimationFrame\(\(\) => document\.querySelector<HTMLElement>\('\.diary-day > h1'\)\?\.focus\(\)\)/);
  assert.match(src, /<section className="diary-day"><h1 tabIndex=\{-1\}>\{dayLabel\(day\)\}<\/h1>/);
});

test('leaving a day focuses that day\'s calendar cell, with the tab stop as the fallback', () => {
  assert.match(navigate, /const leavingDay = day && !nextDay \? day : null;/, 'the day being left is captured before the state changes');
  assert.match(navigate, /\.diary-calendar \[data-day="\$\{leavingDay\}"\]/);
  assert.match(navigate, /\?\? document\.querySelector<HTMLElement>\('\.diary-calendar \[tabindex="0"\]'\)/, 'a day outside the month shown falls back to the calendar\'s tab stop');
});
