'use strict';
// #358: while editing a message, Save & re-run and Cancel must render with the shared button
// classes (so they follow the theme) rather than a browser default or a dead "secondary" class
// that matches no CSS rule. A render test needs a live SSE stream and streaming state that isn't
// worth mocking here, so this asserts directly on the markup ChatView emits for the edit actions.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');
const block = src.slice(src.indexOf('msg-edit-actions'), src.indexOf("t('chat.edit.note')"));

test('the edit actions block exists and is scoped correctly for the assertions below', () => {
  assert.ok(block.includes('chat.edit.save'), 'msg-edit-actions block not found as expected');
});
test('Save & re-run uses the shared primary button classes', () => {
  const save = block.slice(0, block.indexOf("t('chat.edit.save')"));
  assert.match(save, /className="btn btn-primary"/);
});
test('Cancel uses the shared secondary button class, not the dead "secondary" class', () => {
  const cancel = block.slice(block.indexOf("t('chat.edit.save')"));
  assert.match(cancel, /className="btn btn-secondary"/);
  assert.doesNotMatch(cancel, /className="secondary"/);
});

// #355 (reopened): cancelling a message edit (Escape or the Cancel button) must not drop focus to
// <body>. The previous fix called `editTriggers.current.get(id)?.focus()` synchronously from
// cancelEdit — but the trigger is unmounted (and deleted from that map) the instant editing
// starts, and only remounts on the *next* render, after that synchronous call already returned.
// A source-text match on the old one-liner was passing while the real behaviour stayed broken
// (see the issue's live-repro evidence), so this now checks the actual fix: the focus call is
// deferred to a layout effect keyed on `editingId`, through the pure, independently-tested
// `edit-focus.ts` helpers (see tests/client/edit-focus.test.cjs for the race itself).
test('cancelling a message edit defers focus to a layout effect through the tested edit-focus helpers, both from Escape and the Cancel button', () => {
  const editRegion = src.slice(src.indexOf("const [editingId, setEditingId]"), src.indexOf('msg-edit-actions'));
  assert.match(editRegion, /const cancelEdit = \(id: string\) => \{ editFocus\.current = onCancelEdit\(id\); setEditingId\(null\); \};/);
  assert.match(editRegion, /useLayoutEffect\(\(\) => \{\s*const \{ focusId, next \} = focusAfterRender\(editingId, editFocus\.current\);/);
  assert.match(editRegion, /if \(e\.key === 'Escape'\) \{ cancelEdit\(m\.id\); return; \}/);
  assert.match(block, /onClick=\{\(\) => cancelEdit\(m\.id\)\}/);
});
test('ChatView imports the edit-focus helpers rather than reimplementing the race fix inline', () => {
  assert.match(src, /import \{ onCancelEdit, focusAfterRender, type EditFocusState \} from '\.\.\/edit-focus';/);
});
test("the message's Edit button is tracked so cancelEdit can find it back", () => {
  const editButton = src.slice(src.indexOf('msg-edit-btn') - 200, src.indexOf('msg-edit-btn') + 50);
  assert.match(editButton, /editTriggers\.current\.set\(m\.id, ?el\)/);
});

