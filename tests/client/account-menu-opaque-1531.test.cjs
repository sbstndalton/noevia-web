'use strict';
// #1531: the account menu's background let sidebar rows show through. Every family now paints it with an
// opaque fill: the default families through --surface-overlay (a solid surface token), and Glass through its
// solid --glass-menu (the frosted tint baked into the colour, never transparency). This pins those fills so a
// translucent value cannot come back unnoticed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/styles/system', f), 'utf8');
const tokens = read('tokens.css');
const themes = read('themes.css');
const components = read('components.css');

test('the default families paint overlays with a solid surface token, not a translucent one', () => {
  assert.match(tokens, /--surface-overlay: var\(--md-surface-container-low\);/);
  assert.match(components, /\.overlay, \.aero, :is\(\.ctx-menu, \.account-popover, [^{]*\) \{\s*background: var\(--surface-overlay\);/);
});

test('Glass menus take the solid --glass-menu fill in both themes, with no alpha', () => {
  assert.match(themes, /\[data-family='glass'\] :is\(\.ctx-menu, \.account-popover, [^{]*\) \{ --glass-pane: var\(--glass-menu\); \}/);
  assert.match(themes, /\[data-family='glass'\]\[data-theme='light'\] \{ --glass-menu: rgb\(249 249 252\); \}/);
  assert.match(themes, /\[data-family='glass'\]:not\(\[data-theme='light'\]\) \{ --glass-menu: rgb\(33 34 38\); \}/);
});

test('reduced-transparency and high-contrast fall back to an opaque surface too', () => {
  assert.match(themes, /--glass-menu: var\(--md-surface-container-low\);/);
});
