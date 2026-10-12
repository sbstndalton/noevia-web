// #1518: the Diary calendar moves focus with the arrow keys (one roving tab stop, Left/Right a day, Up/Down a
// week), and Escape leaves an open day for its calendar. Synthetic dates only; no Diary content is read.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');

function load(name) {
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Date });
  return exports;
}
const data = load('diary-data.ts');

test('shiftDay steps whole days across month, year and daylight-saving changes', () => {
  assert.equal(data.shiftDay('2026-10-12', 1), '2026-10-13');
  assert.equal(data.shiftDay('2026-10-12', -7), '2026-10-05', 'Up is one week back');
  assert.equal(data.shiftDay('2026-10-05', 7), '2026-10-12', 'Down is one week forward');
  assert.equal(data.shiftDay('2026-10-01', -1), '2026-09-30', 'Left leaves the month');
  assert.equal(data.shiftDay('2026-12-31', 1), '2027-01-01', 'the year turns');
  assert.equal(data.shiftDay('2026-03-29', 1), '2026-03-30', 'the spring clock change does not skip or repeat a day');
  assert.equal(data.shiftDay('2026-10-25', 1), '2026-10-26', 'the autumn clock change does not either');
});

test('the arrow keys map to one day or one week, and every other key to nothing', () => {
  assert.equal(data.calendarArrowStep('ArrowLeft'), -1);
  assert.equal(data.calendarArrowStep('ArrowRight'), 1);
  assert.equal(data.calendarArrowStep('ArrowUp'), -7);
  assert.equal(data.calendarArrowStep('ArrowDown'), 7);
  for (const key of ['Enter', 'Escape', 'Tab', 'a', 'Home']) assert.equal(data.calendarArrowStep(key), null, key);
});

test('the calendar grid is one tab stop, and each day names its id for the arrow keys to find', async () => {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { dataset: {} }, cookie: '' };
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
    try {
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { DiaryCalendar } = await server.ssrLoadModule('/src/components/DiaryCalendar.tsx');
      const render = (props) => renderToStaticMarkup(React.createElement(DiaryCalendar, { month: '2026-10', today: '2026-10-12', days: {}, busy: false, ready: true, navigate() {}, ...props }));
      const cells = (html) => [...html.matchAll(/<button[^>]*data-day="([^"]+)"[^>]*>/g)].map((m) => [m[1], /tabindex="0"/.test(m[0])]);
      const stops = (html) => cells(html).filter(([, stop]) => stop).map(([day]) => day);

      const html = render({});
      assert.equal(cells(html).length, 31, 'every day of October is a button');
      assert.deepEqual(stops(html), ['2026-10-12'], 'today is the single tab stop');
      // A month that does not hold today starts on its first day.
      assert.deepEqual(stops(render({ month: '2026-09', today: '2026-10-12' })), ['2026-09-01']);
      // When a day was focused last (opened, then came back), that day is the tab stop.
      assert.deepEqual(stops(render({ focusDay: '2026-10-05' })), ['2026-10-05']);
      // A remembered day from another month is ignored.
      assert.deepEqual(stops(render({ focusDay: '2026-09-20' })), ['2026-10-12']);
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});

test('DiaryView: Escape leaves an open day, but not from a field or a dialog', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/DiaryView.tsx'), 'utf8');
  assert.match(src, /const escapeDay = \(event: KeyboardEvent<HTMLDivElement>\) => \{/, 'the Escape handler is missing');
  const handler = src.slice(src.indexOf('const escapeDay'), src.indexOf('const escapeDay') + 500);
  assert.match(handler, /event\.key !== 'Escape'/);
  assert.match(handler, /!day \|\| editor/, 'nothing happens without an open day or while the editor is up');
  assert.match(handler, /closest\('input, textarea, select, \[contenteditable="true"\], \[role="dialog"\]'\)/, 'typing and dialogs keep their own Escape');
  assert.match(handler, /navigate\(month\)/, 'Escape goes back to the month calendar, like the breadcrumb');
  assert.match(src, /className="diary-content-scroll" ref=\{scrollRef\} onScroll=\{onScroll\} onKeyDown=\{escapeDay\}/);
});

test('DiaryCalendar: the grid moves focus on arrow keys inside the month, and never onto a future day', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/DiaryCalendar.tsx'), 'utf8');
  assert.match(src, /<div className="diary-calendar" aria-label=\{monthLabel\(month, locale\)\} onKeyDown=\{moveFocus\}>/);
  const move = src.slice(src.indexOf('const moveFocus'), src.indexOf('const moveMonth'));
  assert.match(move, /if \(!inMonth\(to\) \|\| to > today\) return;/, 'a target outside the month or after today is not focused');
  assert.match(move, /event\.preventDefault\(\)/, 'the page does not scroll for an arrow inside the grid');
});
