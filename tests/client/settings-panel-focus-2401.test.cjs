'use strict';
// sbstndalton/noevia#2401: (1) focus the shell moves into the Settings detail panel draws no frame, unless the last input was
// the keyboard; (2) while searching, the chat list's heading says it holds matches. Browser proof:
// qa/settings-panel-focus-2401.cjs and qa/search-heading-2401.cjs (no components are rendered in node tests: wiring is pinned from source).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

test('noevia#2401 programmatic focus on the panel is quiet unless the keyboard was the last input', () => {
  const shell = read('src/components/SettingsShell.tsx');
  assert.match(shell, /onKeyDownCapture=\{\(\) => \{ keyboardInput\.current = true; \}\} onPointerDownCapture=\{\(\) => \{ keyboardInput\.current = false; \}\}/);
  assert.match(shell, /if \(panel && !keyboardInput\.current\) panel\.dataset\.quietFocus = '';\n      panel\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(shell, /onKeyDown=\{\(e\) => \{ if \(e\.target === e\.currentTarget\) delete e\.currentTarget\.dataset\.quietFocus; \}\}/, 'a key press on the panel brings the frame back');
  assert.match(shell, /onBlur=\{\(e\) => \{ if \(e\.target === e\.currentTarget\) delete e\.currentTarget\.dataset\.quietFocus; \}\}/);
});

test('noevia#2401 the quiet state only removes the ring for :focus-visible, and beats the global !important ring', () => {
  const css = read('src/styles/shell-v2.css');
  assert.match(css, /\.settings-stage \.settings-detail-scroll:focus-visible \{ outline: 2px solid var\(--focus-ring\)/, 'keyboard focus keeps its ring');
  assert.match(css, /\.settings-detail-scroll\[data-quiet-focus\]:focus-visible \{ outline: none !important; \}/);
  assert.match(read('src/styles/noevia.css'), /:focus-visible \{ outline:2px solid var\(--focus-ring\)!important/, 'the global ring is still !important (why the override needs it)');
});

test('noevia#2401 the chat list is headed "Matching chats" while a query is typed, in every locale', () => {
  assert.match(read('src/components/Sidebar.tsx'), /\{query \? t\('sidebar\.searchChats'\) : t\('sidebar\.recentChats'\)\}/);
  for (const locale of LOCALES) {
    const c = catalogue(locale);
    assert.ok(c['sidebar.searchChats'], `${locale}: sidebar.searchChats`);
    assert.notEqual(c['sidebar.searchChats'], c['sidebar.recentChats'], `${locale}: not the recents label`);
  }
});
