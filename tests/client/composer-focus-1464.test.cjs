'use strict';
// #1464: the message box shows a visible keyboard focus indicator while focus is inside it (WCAG 2.4.7).
// shell-v2.css zeroes the outline on .app .composer-inner.pane, and the only focus cue left was a 1px
// border. components.css (loaded last) restores a 2px focus-ring outline on :focus-within. Source-contract
// check; the browser check is not run here.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/styles', f), 'utf8');
const shell = read('shell-v2.css'), components = read('system/components.css');

test('the pane composer clears its outline in shell-v2, which is why a focus ring is needed (#1464)', () => {
  assert.match(shell, /\.app \.composer-inner\.pane \{[^}]*outline: 0;/);
});

test('the message box gets a 2px focus-ring outline while focus is inside it (#1464)', () => {
  assert.match(components, /:root \.app \.composer-inner\.pane:focus-within \{ outline: 2px solid var\(--focus-ring\); outline-offset: 2px; \}/);
});

test('the focus ring rule is loaded after shell-v2 so it is not overridden by its outline: 0 (#1464)', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../src/main.tsx'), 'utf8');
  assert.ok(main.indexOf("styles/shell-v2.css") < main.indexOf("styles/system/components.css"));
});
