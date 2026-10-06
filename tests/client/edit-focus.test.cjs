'use strict';
// #355 (reopened): the race behind the message-edit-cancel-Escape focus bug, isolated from React.
// The Edit trigger button unmounts (dropping out of ChatView's ref map) the instant editing
// starts, and only remounts on the render where editingId goes back to null — after cancelEdit's
// own synchronous call already returned, which is why a synchronous `.focus()` from cancelEdit
// itself always found nothing. `onCancelEdit`/`focusAfterRender` split that into "remember which
// trigger to focus" (now) and "focus it" (once the render that brought it back has committed).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/edit-focus.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const exports_ = {};
vm.runInNewContext(code, { exports: exports_ });
const { onCancelEdit, focusAfterRender } = exports_;

test('cancelling an edit remembers which message wants focus back, without touching editingId itself', () => {
  assert.equal(onCancelEdit('m1').pendingFocusId, 'm1');
});

test('the same render that requests the cancel must not fire focus yet — the trigger has not remounted', () => {
  // editingId is still 'm1' on this render (React has not committed the null yet), so the
  // trigger for it does not exist in the DOM/ref-map right now, exactly the state that broke the
  // old synchronous call.
  const { focusId, next } = focusAfterRender('m1', { pendingFocusId: 'm1' });
  assert.equal(focusId, null, 'must not focus before the trigger has had a chance to remount');
  assert.equal(next.pendingFocusId, 'm1', 'keeps waiting');
});

test('once editingId has returned to null (the trigger has remounted), the pending id is focused and cleared', () => {
  const { focusId, next } = focusAfterRender(null, { pendingFocusId: 'm1' });
  assert.equal(focusId, 'm1');
  assert.equal(next.pendingFocusId, null, 'does not fire again on a later render');
});

test('a render with nothing pending never asks for a focus call', () => {
  assert.equal(focusAfterRender(null, { pendingFocusId: null }).focusId, null);
  assert.equal(focusAfterRender('m2', { pendingFocusId: null }).focusId, null);
});

test('starting a fresh edit on another message while one focus is still pending is not lost — the fresh cancel simply replaces it', () => {
  // If the reader cancels m1, then (before that render lands) opens and cancels m2, the pending
  // id should be whichever cancel happened last, since that is the trigger visible once things
  // settle — cancelEdit always calls onCancelEdit again, which overwrites wholesale.
  const afterM1 = onCancelEdit('m1');
  const afterM2 = onCancelEdit('m2');
  assert.equal(afterM2.pendingFocusId, 'm2');
  assert.equal(focusAfterRender(null, afterM2).focusId, 'm2');
  void afterM1;
});
