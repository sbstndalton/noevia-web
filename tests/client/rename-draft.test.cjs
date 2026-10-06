const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRenameDraft } = require('../../src/rename-draft.ts');

// #360: a multi-line chat title prefilling the single-line rename input must not glue words
// together across the dropped newline.
test('collapses a newline into a space instead of dropping it', () => {
  assert.equal(normalizeRenameDraft('List 3 fruits\nand a vegetable'), 'List 3 fruits and a vegetable');
});
test('collapses runs of whitespace (tabs, multiple newlines) to one space', () => {
  assert.equal(normalizeRenameDraft('a\n\n\tb   c'), 'a b c');
});
test('leaves an already single-line title untouched', () => {
  assert.equal(normalizeRenameDraft('Weekend trip planning'), 'Weekend trip planning');
});
test('trims to nothing only if the title itself is only whitespace', () => {
  assert.equal(normalizeRenameDraft('\n\n'), ' ');
});
