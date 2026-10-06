'use strict';
// #355, #360, #362: sidebar search Escape / inline rename / quick-archive undo. Sidebar.tsx wires
// live DOM refs and timers that aren't worth a headless-DOM harness for; the pure pieces
// (normalizeRenameDraft, placeCatalogue-style helpers) have their own unit tests, and this file
// pins the wiring in the markup so a regression that drops a fix is still caught.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');

test('startRename normalises the prefill before it reaches renameDraft state (#360)', () => {
  assert.match(src, /setRenameDraft\(normalizeRenameDraft\(current\)\)/);
});
test('the list rename input has an accessible label (#360)', () => {
  const input = src.slice(src.indexOf("renameSource==='list' ?"), src.indexOf("renameSource==='list' ?") + 400);
  assert.match(input, /aria-label=\{t\('sidebar\.renameChatLabel'\)\}/);
});
test('Escape in the sidebar search returns focus to a search trigger instead of <body> (#355)', () => {
  const handler = src.slice(src.indexOf('shell-search'), src.indexOf('shell-search') + 500);
  assert.match(handler, /searchTrigger\.current\|\|railSearchButton\.current\)\?\.focus\(\)/);
});
test('committing or cancelling a list rename returns focus to that row (#355)', () => {
  const start = src.indexOf("renameSource==='list' ?");
  const input = src.slice(start, src.indexOf('/>', start) + 2);
  // Both Enter (commit) and Escape (cancel) must return focus, not just one of them, and both
  // pass the enclosing row as a fallback (#355, reopened a third time) so a trigger that is
  // still unreachable for any reason falls back to the row's own always-visible button instead
  // of silently dropping to <body>.
  assert.equal((input.match(/returnFocusToRow\(c\.id, ?e\.currentTarget\.closest<HTMLElement>\('\.chat-row'\)\)/g) || []).length, 2);
});
test('committing or cancelling a NESTED (project-child) chat rename returns focus to that row (#355)', () => {
  const start = src.indexOf("renameSource==='nested' ?");
  const input = src.slice(start, src.indexOf('/>', start) + 2);
  assert.equal((input.match(/returnFocusToRow\(c\.id, ?row\)/g) || []).length, 2);
  assert.match(input, /const row ?= ?e\.currentTarget\.closest<HTMLElement>\('\.chat-row'\)/);
});
test('committing or cancelling a PROJECT rename returns focus to that row, not just chats (#355, reopened)', () => {
  const start = src.indexOf('renamingId===p.id ?');
  const input = src.slice(start, src.indexOf('/>', start) + 2);
  // Both Enter (commit) and Escape (cancel) must return focus for a project row exactly the same
  // way a chat row does, with the project row itself as the fallback.
  assert.equal((input.match(/returnFocusToRow\(p\.id, ?row\)/g) || []).length, 2);
  assert.match(input, /const row ?= ?e\.currentTarget\.closest<HTMLElement>\('\.proj-row'\)/);
});
test('returnFocusToRow falls back to the row\'s own always-visible button, never silently drops to <body> (#355, reopened a third time)', () => {
  const fn = src.slice(src.indexOf('const returnFocusToRow'), src.indexOf('const returnFocusToRow') + 1400);
  // A trigger with no real box (still unreachable despite the visibility override below) falls
  // back to the row's nav-item/project-disclosure/nested-chat-title instead of a bare `if (!el)
  // return`, which is what silently dropped focus to <body> before.
  assert.match(fn, /row\?\.querySelector<HTMLElement>\('\.nav-item, ?\.project-disclosure, ?\.nested-chat-title'\)/);
  assert.match(fn, /trigger && trigger\.getClientRects\(\)\.length \? trigger : fallback/);
  // The override targets the properties that actually gate visibility (opacity/pointer-events/
  // width/overflow across noevia.css and phone.css), not `display` — which was never what hid it.
  assert.match(fn, /actions\.style\.opacity ?= ?'1'/);
  assert.match(fn, /actions\.style\.pointerEvents ?= ?'auto'/);
  assert.doesNotMatch(fn, /actions\.style\.display ?= ?'flex'/);
});
test('quick-archive goes through the undo-toast path, not a bare patch call (#362)', () => {
  const archiveButton = src.slice(src.indexOf('sidebar.archiveNamed'), src.indexOf('sidebar.archiveNamed') + 300);
  // #362 (reopened again): archiveChat also takes whether the click was keyboard-activated
  // (event.detail === 0), so a keyboard-initiated archive can put focus straight on the toast's
  // Undo button rather than relying on the ordinary Tab order to find it in time.
  assert.match(archiveButton, /onClick=\{\(e\)=>archiveChat\(c,projectId,e\.detail===0\)\}/);
});
test('the archive-undo toast offers Undo and is announced politely, not as an alert (#362)', () => {
  const toast = src.slice(src.indexOf('archiveUndo &&'), src.indexOf('archiveUndo &&') + 600);
  assert.match(toast, /role="status"/);
  assert.match(toast, /onClick=\{undoArchive\}/);
  assert.match(toast, /common\.undo/);
});
test('a keyboard-initiated archive focuses the toast\'s Undo button, and the auto-dismiss pauses while the toast holds focus (#362)', () => {
  const toast = src.slice(src.indexOf('archiveUndo &&'), src.indexOf('archiveUndo &&') + 600);
  assert.match(toast, /ref=\{undoButtonRef\}/);
  assert.match(toast, /onFocus=\{/);
  assert.match(toast, /onBlur=\{/);
  const effect = src.slice(src.indexOf('archiveUndo?.keyboardInitiated'), src.indexOf('archiveUndo?.keyboardInitiated') + 200);
  assert.match(effect, /undoButtonRef\.current\?\.focus\(\)/);
});
test('undo restores the same chat without touching its position-determining fields (#362)', () => {
  const undo = src.slice(src.indexOf('const undoArchive'), src.indexOf('const undoArchive') + 300);
  assert.match(undo, /onPatchChat\(archiveUndo\.projectId, ?archiveUndo\.chat\.id, ?\{ ?archived: ?false ?\}\)/);
});
test('the row\'s own "…" menu Archive item goes through the same archive+undo path as the hover icon, at any width (#362, reopened a fourth time)', () => {
  const chatMenuStart = src.indexOf('const chatMenu');
  const menuArchiveStart = src.indexOf("sidebar.archive'),\n      icon:<ShellIcon name=\"archive\"", chatMenuStart);
  const menuArchive = src.slice(menuArchiveStart, menuArchiveStart + 900);
  // Previously called onPatchChat directly, which skips the undo toast entirely — at <=700px
  // (where the hover quick-archive icon is hidden) this menu item is the only reachable way to
  // archive a chat, so that gap left touch/narrow users with zero recovery path.
  assert.match(menuArchive, /onSelect: ?\(\) ?=> ?archiveChat\(c, ?c\.projectId ?\?\? ?null, ?false\)/);
  assert.doesNotMatch(menuArchive, /onSelect: ?\(\) ?=> ?onPatchChat\(c\.projectId ?\?\? ?null, ?c\.id, ?\{ ?archived: ?true ?\}\)/);
});
