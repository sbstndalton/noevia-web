'use strict';
// #401: closing Settings (Escape or the Close button) must hand focus back to the control that
// opened it, not to <body>. This repo has no jsdom (see tests/client/menu-focus.test.cjs for the same
// approach), so the pure decision (settings-focus.ts, focus-utils.ts) is unit-tested directly
// here, and the wiring that feeds it — App.tsx capturing an opener before Settings mounts,
// AccountMenu.tsx capturing its trigger before it unmounts its own popover, SettingsShell.tsx
// using both plus a fallback chain — is pinned by reading the source, the same technique
// tests/client/edit-project-modal-focus.test.cjs uses for EditProjectModal's initial-focus wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(relPath, sandboxExtra = {}) {
  const exports_ = {};
  const sandbox = { exports: exports_, require, module: { exports: exports_ }, ...sandboxExtra };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return sandbox.exports;
}

const focusUtils = loadModule('../src/focus-utils.ts');
const { isFocusable, pickFocusable } = focusUtils;

// settings-focus.ts does `import { isFocusable } from './focus-utils'`; transpileModule turns
// that into a `require('./focus-utils')` the sandbox needs to resolve to the module already
// loaded above, since there is no real module loader (or filesystem `.ts` resolution) here.
const settingsFocusExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/settings-focus.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: settingsFocusExports,
  require: (id) => (id === './focus-utils' ? focusUtils : require(id)),
});
const { closeFocusTarget } = settingsFocusExports;

// A visible, connected, non-inert, enabled, natively-focusable (tabIndex 0) element:
// getClientRects reports a layout box, closest never matches `[inert]`, checkVisibility (when
// asked to also check the `visibility` property, as focus-utils.ts does) reports true.
const el = (connected = true, rects = 1, inert = false, { disabled = false, tabIndex = 0, visible = true } = {}) => ({
  isConnected: connected,
  getClientRects: () => new Array(rects).fill(0),
  closest: (sel) => (inert && sel === '[inert]' ? {} : null),
  checkVisibility: () => visible,
  disabled,
  tabIndex,
});
const hidden = () => el(true, 0);
const inertEl = () => el(true, 1, true);
// #401 reopened, measured against a real headless Chrome (see the comment in focus-utils.ts):
// a `disabled` control and a `visibility:hidden` one both still report a non-empty
// `getClientRects()` and a `tabIndex` of `0` — `getClientRects` alone (the original check this
// module shipped with) does not catch either. A plain heading with no `tabindex` reports
// `tabIndex: -1` with everything else looking focusable.
const disabledEl = () => el(true, 1, false, { disabled: true });
const visibilityHiddenEl = () => el(true, 1, false, { visible: false });
const nonInteractiveEl = () => el(true, 1, false, { tabIndex: -1 });

// ── isFocusable / pickFocusable (focus-utils.ts) ────────────────────────────────────────────

test('isFocusable: a connected, visible, non-inert element is focusable', () => {
  assert.equal(isFocusable(el()), true);
});
test('isFocusable: null/undefined is not focusable', () => {
  assert.equal(isFocusable(null), false);
  assert.equal(isFocusable(undefined), false);
});
test('isFocusable: a disconnected element is not focusable', () => {
  assert.equal(isFocusable(el(false)), false);
});
test('#401 reopened: isFocusable rejects a connected element with no client rects (display:none on itself or an ancestor — a collapsed drawer)', () => {
  assert.equal(isFocusable(hidden()), false);
});
test('isFocusable rejects an element inside an inert region even though it has rects', () => {
  assert.equal(isFocusable(inertEl()), false);
});
test('#401 reopened: isFocusable rejects a disabled control even though it reports rects and a tabIndex of 0 (measured, not assumed — see focus-utils.ts)', () => {
  assert.equal(isFocusable(disabledEl()), false);
});
test('#401 reopened: isFocusable rejects a visibility:hidden element (on itself or an inherited-from ancestor) even though it reports rects and a tabIndex of 0', () => {
  assert.equal(isFocusable(visibilityHiddenEl()), false);
});
test('#401 reopened: isFocusable rejects a non-interactive element with no tabindex (e.g. a bare <h1>) even though it reports rects and passes every other check — .focus() on it is a silent no-op', () => {
  assert.equal(isFocusable(nonInteractiveEl()), false);
});
test('isFocusable skips checks a candidate does not support (the plain isConnected/getClientRects/closest objects this suite otherwise uses)', () => {
  assert.equal(isFocusable({ isConnected: true, getClientRects: () => [0] }), true);
});
test('pickFocusable returns the first focusable candidate and skips the rest', () => {
  const target = el();
  assert.equal(pickFocusable(hidden(), target, el()), target);
});
test('pickFocusable returns null when nothing in the list is focusable', () => {
  assert.equal(pickFocusable(hidden(), null, inertEl()), null);
});

// ── closeFocusTarget (settings-focus.ts) ────────────────────────────────────────────────────

test('a still-connected, visible opener (Escape from the ⌘, path, or an ordinary trigger click) gets focus back', () => {
  const opener = el(true);
  assert.equal(closeFocusTarget(opener, el(true)), opener);
});

test('#401 regression: an opener the caller already unmounted (the account menu\'s own popover button) falls through to the fallback, not <body>', () => {
  const fallback = el(true);
  assert.equal(closeFocusTarget(el(false), fallback), fallback);
});

test('#401 reopened: an opener that is still connected but sits inside a display:none drawer also falls through to the fallback', () => {
  const fallback = el(true);
  assert.equal(closeFocusTarget(hidden(), fallback), fallback);
});

test('no opener at all (nothing was focused, e.g. a fresh page load into Settings) also falls through to the fallback', () => {
  const fallback = el(true);
  assert.equal(closeFocusTarget(null, fallback), fallback);
});

test('no fallback either (an exotic entry with neither) resolves to null rather than throwing', () => {
  assert.equal(closeFocusTarget(null, null), null);
  assert.equal(closeFocusTarget(el(false), null), null);
});

// ── Wiring: the pure decision above is only correct if the right elements reach it ─────────────

const settingsShellSrc = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsShell.tsx'), 'utf8');
const accountMenuSrc = fs.readFileSync(path.join(__dirname, '../../src/components/AccountMenu.tsx'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
const sidebarSrc = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');

test('SettingsShell reads the opener from a prop rather than capturing document.activeElement on its own mount', () => {
  assert.match(settingsShellSrc, /import \{ closeFocusTarget \} from '\.\.\/settings-focus';/);
  assert.match(settingsShellSrc, /import \{ afterLayoutSettles, pickFocusable \} from '\.\.\/focus-utils';/);
  assert.match(settingsShellSrc, /import \{ isCoarsePointerDevice \} from '\.\.\/composer-focus';/);
  assert.match(settingsShellSrc, /const previous = opener\?\.current \?\? \(document\.activeElement as HTMLElement \| null\);/);
});

test('#401 reopened: the close-time fallback is computed after layout settles (rAF + a timer, for a hidden tab) and re-queries the account trigger, the narrow-width nav-drawer toggle and the composer, in that order', () => {
  assert.match(settingsShellSrc, /afterLayoutSettles\(\(\) => \{/);
  assert.match(settingsShellSrc, /pickFocusable<HTMLElement>\(\s*\n\s*document\.querySelector<HTMLElement>\('\.account-trigger'\),\s*\n\s*document\.querySelector<HTMLElement>\('\.nav-drawer-toggle'\),\s*\n\s*isCoarsePointerDevice\(\) \? null : document\.querySelector<HTMLElement>\('\.composer-input'\),\s*\n\s*\);/);
  assert.match(settingsShellSrc, /closeFocusTarget\(previous, fallback\)\?\.focus\(\{ preventScroll: true \}\);/);
});

test('#446/#401: the composer is never a fallback candidate on a coarse pointer (touch) — focusing a text field would pop the on-screen keyboard, the same tradeoff ChatView.tsx already makes for #435', () => {
  assert.match(settingsShellSrc, /isCoarsePointerDevice\(\) \? null : document\.querySelector<HTMLElement>\('\.composer-input'\)/);
});

test('#401 regression: AccountMenu captures its own (still-mounted) trigger before closing its popover, not after', () => {
  // The bug: `setOpen(false)` unmounts the clicked popover item in the same batched update that
  // opens Settings, so reading `trigger.current` (or activeElement) afterwards is too late.
  const settingsItem = accountMenuSrc.match(/onClick=\{\(\)=>\{const opener=trigger\.current;setOpen\(false\);onSettings\(undefined,opener\);\}\}/);
  const usageItem = accountMenuSrc.match(/onClick=\{\(\)=>\{const opener=trigger\.current;setOpen\(false\);onSettings\('usage',opener\);\}\}/);
  assert.ok(settingsItem, 'the Settings menu item must read trigger.current before setOpen(false)');
  assert.ok(usageItem, 'the Usage menu item must read trigger.current before setOpen(false)');
});

test('the opener flows end to end: AccountMenu -> Sidebar -> App.openSettings -> a ref passed to SettingsShell', () => {
  assert.match(accountMenuSrc, /onSettings:\(section\?:'general'\|'usage', opener\?: HTMLElement \| null\)=>void/);
  assert.match(sidebarSrc, /onOpenSettings: \(section\?: 'general'\|'usage'\|'connectors', opener\?: HTMLElement \| null\) => void;/);
  assert.match(sidebarSrc, /onOpenSettings\(section, opener\)/);
  assert.match(appSrc, /const openSettings = \(section: SettingsSection = 'general', opener\?: HTMLElement \| null\) => \{/);
  assert.match(appSrc, /settingsOpenerRef\.current = opener !== undefined \? opener : \(typeof document !== 'undefined' \? \(document\.activeElement as HTMLElement \| null\) : null\);/);
  assert.match(appSrc, /opener=\{settingsOpenerRef\}/);
});
