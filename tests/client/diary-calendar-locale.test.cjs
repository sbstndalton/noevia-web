// #619: the Diary calendar's month heading and day labels follow the interface locale (Intl), and
// its week starts where that locale's does. Synthetic dates only; no Diary content is read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, extra = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Date, ...extra });
  return exports;
}
const dates = load('diary-data.ts');
const nbsp = (s) => s.replace(/[  ]/g, ' ');

test('the month heading is written in the interface locale, not English', () => {
  assert.equal(dates.monthLabel('2026-09', 'fr-FR'), 'septembre 2026');
  assert.equal(dates.monthLabel('2026-09', 'de-DE'), 'September 2026');
  assert.equal(dates.monthLabel('2026-09', 'es-ES'), 'septiembre de 2026');
  assert.equal(dates.monthLabel('2026-09', 'nb-NO'), 'september 2026');
  assert.equal(dates.monthLabel('2026-09', 'en-GB'), 'September 2026');
  assert.match(dates.monthLabel('2026-03', 'it-IT'), /^marzo 2026$/);
  assert.match(dates.monthLabel('2026-03', 'nl-NL'), /^maart 2026$/);
  assert.match(dates.monthLabel('2026-03', 'pt-BR'), /^março de 2026$/);
  assert.match(dates.monthLabel('2026-03', 'sv-SE'), /^mars 2026$/);
});

test('the day label used in each day button is written in the interface locale', () => {
  assert.equal(nbsp(dates.dayLabel('2026-09-01', 'fr-FR')), '1 septembre 2026');
  assert.equal(nbsp(dates.dayLabel('2026-09-01', 'de-DE')), '1. September 2026');
  assert.equal(nbsp(dates.dayLabel('2026-09-01', 'en-US')), 'September 1, 2026');
  assert.equal(nbsp(dates.dayLabel('2026-09-01', 'en-GB')), '1 September 2026');
  assert.doesNotMatch(dates.dayLabel('2026-09-02', 'fr-FR'), /September/);
});

test('the week starts on Monday for the European locales and Sunday for en-US and pt-BR', () => {
  for (const locale of ['de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL', 'nb-NO', 'sv-SE', 'en-GB']) assert.equal(dates.firstWeekday(locale), 1, locale);
  // CLDR: Brazil and the United States start on Sunday.
  for (const locale of ['en-US', 'pt-BR']) assert.equal(dates.firstWeekday(locale), 0, locale);
  assert.equal(dates.firstWeekday('ar-EG'), 6, 'a Saturday-first locale');
  assert.ok([0, 1, 6].includes(dates.firstWeekday('not a locale')), 'a bad tag never throws and still answers');
});

test('with no week info in the runtime the fallback table answers, Monday for most of Europe', () => {
  for (const tag of ['de-DE', 'fr-FR', 'fr', 'es-ES', 'it-IT', 'nl-NL', 'nb-NO', 'nb', 'no', 'sv-SE', 'en-GB', 'de-AT', 'pl-PL']) assert.equal(dates.fallbackFirstWeekday(tag), 1, tag);
  for (const tag of ['en-US', 'en', 'pt-BR', 'pt', 'ja-JP', 'en_US']) assert.equal(dates.fallbackFirstWeekday(tag), 0, tag);
  assert.equal(dates.fallbackFirstWeekday('ar-EG'), 6);
  assert.equal(dates.fallbackFirstWeekday(''), 0, 'an empty tag is treated as English');
});

test('a runtime that only has the weekInfo property (no getWeekInfo) is read too', () => {
  class OldLocale { constructor(tag) { this.tag = tag; } get weekInfo() { return { firstDay: this.tag.startsWith('fr') ? 1 : 7 }; } }
  const old = load('diary-data.ts', { Intl: { ...Intl, Locale: OldLocale, DateTimeFormat: Intl.DateTimeFormat } });
  assert.equal(old.firstWeekday('fr-FR'), 1);
  assert.equal(old.firstWeekday('en-US'), 0, 'Intl reports Sunday as 7; the calendar wants 0');
  class NoInfo { constructor() {} }
  const none = load('diary-data.ts', { Intl: { ...Intl, Locale: NoInfo } });
  assert.equal(none.firstWeekday('de-DE'), 1, 'the table answers when the runtime cannot');
  assert.equal(none.firstWeekday('en-US'), 0);
  class Throws { constructor() { throw new RangeError('bad'); } }
  assert.equal(load('diary-data.ts', { Intl: { ...Intl, Locale: Throws } }).firstWeekday('fr-FR'), 1);
});

test('September 2026 (a Tuesday start) lines up under the right weekday for each first day', () => {
  // 2026-09-01 is a Tuesday: 2 blanks after Sunday, 1 after Monday.
  const sunday = dates.calendarDays('2026-09', 0), monday = dates.calendarDays('2026-09', 1);
  assert.equal(sunday.indexOf('2026-09-01'), 2);
  assert.equal(monday.indexOf('2026-09-01'), 1);
  assert.equal(dates.calendarDays('2026-09').indexOf('2026-09-01'), 2, 'Sunday stays the default');
  assert.equal(monday.filter(Boolean).length, 30);
  // A month starting on a Sunday needs a full row of blanks in a Monday-first week (2026-03-01 is a Sunday).
  assert.equal(dates.calendarDays('2026-03', 1).indexOf('2026-03-01'), 6);
  assert.equal(dates.calendarDays('2026-03', 0).indexOf('2026-03-01'), 0);
  // Leap day, Monday-first: 2024-02-01 is a Thursday.
  const leap = dates.calendarDays('2024-02', 1);
  assert.equal(leap.indexOf('2024-02-01'), 3);
  assert.equal(leap.at(-1), '2024-02-29');
});

test('the calendar component passes the locale through and rotates the weekday header', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryCalendar.tsx'), 'utf8');
  assert.match(src, /appLocale\(\)/);
  assert.match(src, /firstWeekday\(locale\)/);
  assert.match(src, /monthLabel\(month, locale\)/);
  assert.match(src, /dayLabel\(day, locale\)/);
  assert.match(src, /calendarDays\(month, first\)/);
  assert.match(src, /weekdayKeys\.slice\(first\), \.\.\.weekdayKeys\.slice\(0, first\)/);
});
