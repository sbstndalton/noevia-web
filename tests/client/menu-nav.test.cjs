// #345: the pointerdown/keydown contract every open menu-like popup shares (ContextMenu,
// AccountMenu). No jsdom is installed in this repo, so `createMenuHandlers` is exercised
// directly against fake elements/events — the same technique tests/client/menu-focus.test.cjs
// already uses for shouldRefocusTrigger — rather than mounting real DOM nodes.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/menu-nav.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const exports_ = {};
const fakeDocument = { activeElement: null };
vm.runInNewContext(code, {
  exports: exports_,
  document: fakeDocument,
  // useEffect is never invoked by these tests (only the plain createMenuHandlers export is),
  // but the transpiled `require('react')` at module load still has to resolve to something.
  require: (m) => { if (m === 'react') return { useEffect: () => {} }; throw new Error('unexpected import ' + m); },
});
const { createMenuHandlers } = exports_;

function fakeButton(disabled = false) {
  return { disabled, focused: false, focus() { this.focused = true; }, contains(n) { return n === this; } };
}
function fakeMenu(buttons) {
  return {
    buttons,
    contains(n) { return n === this || buttons.includes(n); },
    querySelectorAll(sel) { return buttons.filter((b) => (/:not\(:disabled\)/.test(sel) ? !b.disabled : true)); },
  };
}
const keyEvent = (key) => ({ key, prevented: false, preventDefault() { this.prevented = true; } });
const pointerEvent = (target) => ({ target });

test('a pointerdown outside the menu and its trigger closes it', () => {
  const buttons = [fakeButton(), fakeButton()];
  const menu = fakeMenu(buttons);
  const trigger = fakeButton();
  let closed = false;
  const { onPointerDown } = createMenuHandlers({ current: menu }, { current: trigger }, () => { closed = true; });
  onPointerDown(pointerEvent({}));
  assert.equal(closed, true);
});

test('a pointerdown on the menu or its own trigger does not close it', () => {
  const buttons = [fakeButton()];
  const menu = fakeMenu(buttons);
  const trigger = fakeButton();
  let closed = false;
  const { onPointerDown } = createMenuHandlers({ current: menu }, { current: trigger }, () => { closed = true; });
  onPointerDown(pointerEvent(buttons[0]));
  onPointerDown(pointerEvent(trigger));
  assert.equal(closed, false, 'a click on the trigger that opened the menu should not immediately read as "outside"');
});

test('Escape closes the menu and returns focus to the trigger', () => {
  const menu = fakeMenu([fakeButton()]);
  const trigger = fakeButton();
  let closed = false;
  const { onKeyDown } = createMenuHandlers({ current: menu }, { current: trigger }, () => { closed = true; });
  const e = keyEvent('Escape');
  onKeyDown(e);
  assert.equal(closed, true);
  assert.equal(trigger.focused, true);
  assert.equal(e.prevented, true);
});

test('Tab closes the menu without stopping the browser from moving focus on', () => {
  const menu = fakeMenu([fakeButton()]);
  const trigger = fakeButton();
  let closed = false;
  const { onKeyDown } = createMenuHandlers({ current: menu }, { current: trigger }, () => { closed = true; });
  const e = keyEvent('Tab');
  onKeyDown(e);
  assert.equal(closed, true);
  assert.equal(e.prevented, false, 'Tab must keep moving focus natively — preventing it would trap focus inside');
});

test('ArrowDown/ArrowUp rove focus between the menu buttons and wrap at the ends', () => {
  const buttons = [fakeButton(), fakeButton(), fakeButton()];
  const menu = fakeMenu(buttons);
  const { onKeyDown } = createMenuHandlers({ current: menu }, { current: fakeButton() }, () => {});
  fakeDocument.activeElement = buttons[0];
  onKeyDown(keyEvent('ArrowDown'));
  assert.equal(buttons[1].focused, true);
  fakeDocument.activeElement = buttons[2];
  onKeyDown(keyEvent('ArrowDown'));
  assert.equal(buttons[0].focused, true, 'ArrowDown from the last item wraps to the first');
  fakeDocument.activeElement = buttons[0];
  onKeyDown(keyEvent('ArrowUp'));
  assert.equal(buttons[2].focused, true, 'ArrowUp from the first item wraps to the last');
});

test('Home and End jump to the first and last button, skipping disabled ones', () => {
  const buttons = [fakeButton(), fakeButton(true), fakeButton()];
  const menu = fakeMenu(buttons);
  const { onKeyDown } = createMenuHandlers({ current: menu }, { current: fakeButton() }, () => {});
  fakeDocument.activeElement = buttons[0];
  onKeyDown(keyEvent('End'));
  assert.equal(buttons[2].focused, true);
  buttons.forEach((b) => (b.focused = false));
  fakeDocument.activeElement = buttons[2];
  onKeyDown(keyEvent('Home'));
  assert.equal(buttons[0].focused, true);
});
