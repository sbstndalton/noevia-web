'use strict';
// #1465: the phone navigation drawer is aria-modal, so the page behind it is inert while it is open,
// and only one toggle is reported. Sidebar.tsx wires live DOM refs and effects, so these are
// source-contract checks on the wiring (as in sidebar-focus-and-undo.test.cjs).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');

test('the open phone drawer makes the page behind it inert until it closes (#1465)', () => {
  const start = src.indexOf('// #1465: at phone width');
  const block = src.slice(start, start + 800);
  assert.match(block, /if \(!mobile \|\| !expanded\) return;/);
  assert.match(block, /querySelectorAll<HTMLElement>\('\.app-stack, \.app \.nav-drawer-toggle'\)/);
  assert.match(block, /el\.setAttribute\('inert', ''\)/);
  // The cleanup releases the inert state, so closing hands the page back before focus returns.
  assert.match(block, /return \(\) => \{ for \(const el of behind\) el\.removeAttribute\('inert'\); \};/);
});

test('the drawer close button is not reported as a second expanded toggle on phone width (#1465)', () => {
  assert.match(src, /aria-expanded=\{mobile \? undefined : !collapsed\}/);
  assert.doesNotMatch(src, /aria-expanded=\{mobile \? expanded : !collapsed\}/);
});
