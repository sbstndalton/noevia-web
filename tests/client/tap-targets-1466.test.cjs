'use strict';
// #1466: at phone width every touch control in the drawer, composer and Diary reaches 44 px. The
// measured sizes were 36x44 (composer add), 28x44 (project expand), 44x26 (sidebar Chat/Code),
// 42x44 (Diary List) and 395x41 (Diary file rows). Source-contract checks on phone.css, which is
// where the phone rules live.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../../src/styles/phone.css'), 'utf8');
const block = css.slice(css.indexOf('/* #1466:'));

test('the phone tap-target rules live in a max-width 519px block, the phone breakpoint (#1466)', () => {
  assert.match(block, /@media \(max-width: 519px\) \{/);
});

test('each measured control gets a 44px minimum on the axis it was too small on (#1466)', () => {
  assert.match(block, /\.composer-add\.glass \{ min-width: var\(--target-min\); min-height: var\(--target-min\); \}/);
  assert.match(block, /\.app \.sidebar\.pane \.proj-row > \.project-expand \{ min-width: var\(--target-min\); \}/);
  assert.match(block, /\.app \.sidebar\.pane \.app-mode-switch\.is-compact button \{ min-height: var\(--target-min\); \}/);
  assert.match(block, /\.diary-view-toggle \.popup-tab \{ min-width: var\(--target-min\); min-height: var\(--target-min\); \}/);
  assert.match(block, /\.diary-file-list button \{ min-height: var\(--target-min\); \}/);
});

test('the token is the 44px target minimum the rest of the system uses (#1466)', () => {
  const tokens = fs.readFileSync(path.join(__dirname, '../../src/styles/system/tokens.css'), 'utf8');
  assert.match(tokens, /--target-min: 44px;/);
});
