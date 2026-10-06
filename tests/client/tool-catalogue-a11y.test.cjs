// #345: the tools catalogue trigger's aria-haspopup must match the panel it opens, and the
// panel must not carry a dialog role that contradicts a non-modal combobox+listbox. `open` is a
// prop here (unlike AccountMenu's own state), so a static render — react-dom/server through
// Vite's SSR pipeline, as tests/client/customise-i18n-render.test.cjs already does — is enough to see
// the open panel's markup without a DOM or simulated clicks.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('the open tools-catalogue panel has no dialog role and its trigger matches the panel it opens', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { dataset: {} }, cookie: '' };
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    Object.defineProperty(global, 'navigator', { value: { language: 'en-US', languages: ['en-US'] }, configurable: true, writable: true });
    try {
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { ToolCatalogue } = await server.ssrLoadModule('/src/components/ToolCatalogue.tsx');
      const html = renderToStaticMarkup(React.createElement(ToolCatalogue, {
        open: true, onOpenChange() {}, projectId: null, mode: 'chat',
        toggled: [], onToggle() {}, onMention() {}, onBoxes() {}, disabled: false,
      }));
      assert.ok(html.includes('aria-haspopup="listbox"'), `trigger lost aria-haspopup="listbox": ${html.slice(0, 400)}`);
      assert.ok(!html.includes('role="dialog"'), `the panel still carries a dialog role, contradicting the listbox trigger: ${html.slice(0, 400)}`);
      assert.ok(html.includes('role="combobox"'), 'the search input should stay the combobox');
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});
