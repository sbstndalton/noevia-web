const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialFocusTarget } = require('../../src/components/useModalDialog.ts');

// A minimal stand-in for a <dialog> element: just enough querySelector behaviour to drive
// initialFocusTarget without a real DOM (#363).
function fakeDialog(marked, firstField) {
  return {
    querySelector(selector) {
      if (selector === '[data-initial-focus]') return marked || null;
      return firstField || null;
    },
  };
}

test('focuses the element marked data-initial-focus over anything else', () => {
  const marked = { name: 'marked' };
  const field = { name: 'field' };
  assert.equal(initialFocusTarget(fakeDialog(marked, field)), marked);
});
test('falls back to the first form field when nothing is marked', () => {
  const field = { name: 'field' };
  assert.equal(initialFocusTarget(fakeDialog(null, field)), field);
});
test('returns null rather than focusing anything (e.g. the Close button) when neither exists', () => {
  assert.equal(initialFocusTarget(fakeDialog(null, null)), null);
});
test('a null dialog (not yet mounted) is handled without throwing', () => {
  assert.equal(initialFocusTarget(null), null);
});
