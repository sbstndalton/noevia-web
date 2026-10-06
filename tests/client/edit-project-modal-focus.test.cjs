'use strict';
// #396: EditProjectModal called `ref.current?.showModal()` directly in its own effect, with no
// `data-initial-focus` marker, so native showModal() focused the first focusable element in DOM
// order — the header Close button — instead of the name field, the same class of bug #363 fixed
// in useModalDialog for ProjectsView's create dialog. This repo has no jsdom/@testing-library
// (see tests/client/model-popup-manual-pin.test.cjs for the same source-pattern approach), so this
// asserts the fixed wiring directly against the source; the focus-selection logic itself is
// covered end-to-end by tests/client/use-modal-dialog.test.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/EditProjectModal.tsx'), 'utf8');

test('EditProjectModal routes its dialog through useModalDialog, the same as ProjectsView\'s create dialog', () => {
  assert.match(src, /import \{ useModalDialog \} from '\.\/useModalDialog';/);
  assert.match(src, /const ref = useModalDialog\(\);/);
});

test('EditProjectModal no longer calls showModal() itself (that responsibility moved into useModalDialog)', () => {
  assert.doesNotMatch(src, /showModal\(\)/, 'a direct showModal() call bypasses useModalDialog\'s initial-focus handling');
});

test('the project name input is marked data-initial-focus, so it — not the header Close button — receives focus on open', () => {
  const inputMatch = src.match(/<input\s+aria-label=\{t\('projects\.edit\.nameLabel'\)\}[\s\S]*?\/>/);
  assert.ok(inputMatch, 'expected to find the project name <input>');
  assert.match(inputMatch[0], /data-initial-focus/);
});

test('the Close button in the header is not itself marked for initial focus', () => {
  const headerMatch = src.match(/<header>[\s\S]*?<\/header>/);
  assert.ok(headerMatch);
  assert.doesNotMatch(headerMatch[0], /data-initial-focus/);
});
