// #1423: a Diary day whose entries failed to load is not shown as a blank page. Until the entries have loaded
// the day says it is loading; when the load failed it says so and offers a retry, and the calendar does too.
// Source contracts plus a static render; synthetic data only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');

test('the day view shows the load state, never the blank-page invitation, until entries have loaded', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/DiaryView.tsx'), 'utf8');
  const day = src.slice(src.indexOf('{day && <section className="diary-day">'), src.indexOf('{day && <section className="diary-day">') + 900);
  assert.match(day, /\(overview\.ready\s*\n?\s*\? <p className="diary-intro">\{t\('diary\.day\.blankPage'\)\}<\/p>/, 'the blank page only shows once the overview is ready');
  assert.match(day, /overview\.failed \? t\('diary\.calendar\.loadFailed'\) : t\('diary\.calendar\.loading'\)/, 'a failed load says so, and a pending one says it is loading');
  assert.match(day, /onClick=\{bumpRevision\}>\{t\('diary\.calendar\.retryLoad'\)\}/, 'the failed state offers a retry that refetches the overview');
});

test('the calendar offers the same retry, and only when it has a handler', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/DiaryView.tsx'), 'utf8');
  assert.match(src, /onRetry=\{bumpRevision\}/);
  const cal = fs.readFileSync(path.join(SRC, 'components/DiaryCalendar.tsx'), 'utf8');
  assert.match(cal, /\{!ready && failed && onRetry && <> <button className="popup-tab" disabled=\{busy\} onClick=\{onRetry\}>\{t\('diary\.calendar\.retryLoad'\)\}<\/button><\/>\}/);
});

test('a failed calendar load renders its message and retry, and a pending one only the loading text', async () => {
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
      const render = (props) => renderToStaticMarkup(React.createElement(DiaryCalendar, { month: '2026-10', today: '2026-10-12', days: {}, busy: false, navigate() {}, ...props }));
      const failed = render({ ready: false, failed: true, onRetry() {} });
      assert.match(failed, /diary-calendar-status[^>]*>diary\.calendar\.loadFailed/);
      assert.match(failed, /<button[^>]*>diary\.calendar\.retryLoad<\/button>/);
      const pending = render({ ready: false, failed: false, onRetry() {} });
      assert.match(pending, /diary-calendar-status[^>]*>diary\.calendar\.loading<\/p>/);
      assert.doesNotMatch(pending, /retryLoad/, 'no retry while the first load is still in flight');
      assert.doesNotMatch(render({ ready: false, failed: true }), /retryLoad/, 'no retry button without a retry handler');
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});
