// #345: the account menu popover needs menu/menuitem semantics and its trigger needs
// aria-haspopup="menu". `open` is AccountMenu's own state (set by clicking the trigger), not a
// prop, so react-dom/server's effect-free static render can only ever show the closed markup —
// there is no jsdom in this repo to simulate the click. The closed-state trigger attributes are
// checked by rendering it (as tests/client/customise-i18n-render.test.cjs does for other components);
// the open popover's role/menuitem markup, which only exists once state flips, is checked by
// reading the JSX source for the literal attributes, the same technique
// tests/client/customise-i18n-render.test.cjs already uses to pin ReasoningControl's i18n keys. The
// dynamic keyboard contract itself (arrow nav, Tab-closes, Escape-refocuses) is covered for real
// in tests/client/menu-nav.test.cjs, which AccountMenu shares with ContextMenu via useMenuNav.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the trigger advertises a menu before it opens', async () => {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { dataset: {} }, cookie: '' };
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    Object.defineProperty(global, 'navigator', { value: { language: 'en-US', languages: ['en-US'] }, configurable: true, writable: true });
    try {
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { AccountMenu } = await server.ssrLoadModule('/src/components/AccountMenu.tsx');
      const html = renderToStaticMarkup(React.createElement(AccountMenu, { onSettings() {}, theme: 'dark', onToggleTheme() {} }));
      assert.ok(html.includes('aria-haspopup="menu"'), `trigger is missing aria-haspopup="menu": ${html.slice(0, 400)}`);
      assert.ok(html.includes('aria-expanded="false"'), 'the menu should start closed');
      assert.ok(!html.includes('role="menu"'), 'the popover is portalled and only exists while open, so it must not be in the closed markup');
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});

test('the open popover is a real menu: role="menu" on the popover, role="menuitem" on every action', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/AccountMenu.tsx'), 'utf8');
  assert.match(src, /role="menu"/, 'the popover lost its menu role');
  const buttonLines = [...src.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
  const popoverButtons = buttonLines.filter((b) => !b.includes('className="account-trigger"'));
  assert.ok(popoverButtons.length >= 3, `expected at least settings/usage/log-out buttons, found ${popoverButtons.length}`);
  for (const button of popoverButtons) {
    assert.match(button, /role="menuitem"/, `a popover action is missing role="menuitem": ${button}`);
  }
  assert.doesNotMatch(buttonLines.find((b) => b.includes('account-trigger')) || '', /role="menuitem"/, 'the trigger itself is not a menu item');
});
