'use strict';
// #1469: an address that names no page gets the app's own not-found page (with a New chat button),
// not a raw JSON body. App.tsx carries the wiring; the server half (a navigation-only shell as a
// 404) is pinned in noevia-core's server/spa-routes.test.cjs. Source-contract checks, because App.tsx
// mounts the whole shell and is not worth a headless harness for this.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../../src/routes.ts'), 'utf8');

test('readInitialNav reports an address that names no page as unknown, not as a silent new chat (#1469)', () => {
  const fn = app.slice(app.indexOf('function readInitialNav'), app.indexOf('export default function App'));
  assert.match(fn, /if \(!matched\) return \{ route: \{ kind: 'new' \}, stored: null, unknown: true \};/);
  assert.match(fn, /unknown: false/);
});

test('the not-found page is rendered with a New chat button, and the chat view is held back while it shows (#1469)', () => {
  const block = app.slice(app.indexOf('{pageMissing && ('), app.indexOf('{pageMissing && (') + 500);
  assert.match(block, /tr\('nav\.notFound\.pageTitle'\)/);
  assert.match(block, /tr\('nav\.notFound\.pageBody'\)/);
  assert.match(block, /onClick=\{\(\) => \{ setPageMissing\(false\); startFreeChat\(\); \}\}/);
  assert.match(app, /view\.kind === 'chat' && !chatMissing && !projectMissing && !pageMissing && \(/);
});

test('the address bar keeps the unknown address while the not-found page shows (#1469)', () => {
  const sync = app.slice(app.indexOf('const syncedPlace = useRef'), app.indexOf('// Back/Forward: show the place'));
  assert.match(sync, /if \(pageMissing\) return;/);
});

test('leaving the not-found page for any other view clears it (#1469)', () => {
  assert.match(app, /const viewAtLoad = useRef\(view\);/);
  assert.match(app, /useEffect\(\(\) => \{ if \(view !== viewAtLoad\.current\) setPageMissing\(false\); \}, \[view\]\);/);
});

test('the route mapping still reads an unknown path as no place, so the App can tell it apart (#1469)', () => {
  // matchPath returns null for an unknown page; parsePath keeps the new-chat fallback for other callers.
  assert.match(routes, /export function matchPath/);
  assert.match(routes, /export function parsePath\(pathname: string\): Route \{\n  return matchPath\(pathname\) \?\? \{ kind: 'new' \};/);
});

test('every catalogue carries the not-found page strings (#1469)', () => {
  const dir = path.join(__dirname, '../../src/i18n');
  // en-US only overrides spellings (it falls back to en-GB for the rest), so it is not checked.
  for (const file of fs.readdirSync(dir).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts')) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.match(src, /'nav\.notFound\.pageTitle':/, file);
    assert.match(src, /'nav\.notFound\.pageBody':/, file);
  }
});
