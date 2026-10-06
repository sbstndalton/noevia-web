'use strict';
// #436: the "Jump to latest" action was 27px tall (padding 6px 14px around caption-size text) with
// no coarse-pointer override, well under a touch target. This checks the CSS rule exists, follows
// the same `@media (pointer: coarse) { … min-height: 44px; }` pattern the sibling composer and
// overlay controls already use, and that the fine-pointer sizing stays unchanged while its shape follows the family (#492).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../../src/styles/app.css'), 'utf8');

test('fine-pointer sizing is unchanged and corners follow the family action role', () => {
  assert.match(css, /\.jump-to-latest \{\s*\n\s*position: sticky; bottom: 8px; align-self: center; z-index: 2;\s*\n\s*display: inline-flex; align-items: center; gap: 6px;\s*\n\s*background: var\(--bg-card\); border: 1px solid var\(--border\); border-radius: var\(--radius-button\);\s*\n\s*color: var\(--text\); cursor: pointer;\s*\n\s*font-family: var\(--font-ui\); font-size: var\(--text-caption\); font-weight: 600;\s*\n\s*padding: 6px 14px; box-shadow: var\(--shadow-pop\);\s*\n\s*\}/);
});

test('a coarse-pointer media query grows the hit area to at least 44px, the same pattern other composer/overlay controls use', () => {
  assert.match(css, /@media \(pointer: coarse\) \{ \.jump-to-latest \{ min-height: 44px; \} \}/);
});

test('the min-height value matches the 44px convention used elsewhere in the codebase (not a one-off number)', () => {
  const stylesDir = path.join(__dirname, '../../src/styles');
  const otherFiles = ['noevia.css', 'phone.css', 'overlays.css'].map(f => fs.readFileSync(path.join(stylesDir, f), 'utf8'));
  const siblingMatches = otherFiles.reduce((n, text) => n + (text.match(/@media \(pointer: coarse\)[^{]*\{[^}]*min-height:\s*44px/g) || []).length, 0);
  assert.ok(siblingMatches >= 1, 'expected at least one existing sibling rule elsewhere using the same coarse-pointer 44px convention');
});
