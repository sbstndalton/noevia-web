// #1566: the Diary calendar's loading line keeps one line of height whether or not it has text, so the
// weekday row and the day cells do not move when "Loading entries" clears. Synthetic dates only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');

function block(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, `no rule for ${selector}`);
  const open = source.indexOf('{', start), close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

test('the loading line is one line high, and a retry button in it cannot make it taller', () => {
  assert.match(block(css, '.diary-calendar-status {'), /min-height:1lh/);
  assert.match(block(css, '.diary-calendar-status .popup-tab {'), /min-height:0/);
});

test('the line is rendered in both states, so loaded and loading markup share one place', async () => {
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
      assert.match(render({ ready: true }), /<p class="diary-calendar-status" role="status"><\/p>/, 'loaded: an empty line keeps its place');
      assert.match(render({ ready: false }), /diary-calendar-status[^>]*>diary\.calendar\.loading<\/p>/, 'loading: the same line carries the text');
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});
