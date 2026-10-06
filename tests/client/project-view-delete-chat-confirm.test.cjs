'use strict';
// #397: the project-detail chat list's small X deleted a chat immediately on click — a genuinely
// irreversible action (unlike the sidebar's quick-archive, #362, which is reversible via
// Archived) — with no confirmation and no undo. The fix routes it through the same ConfirmDialog
// pattern this file already uses for "Delete file"/"Remove image" (and the sidebar uses for its
// own chat-delete menu item), so onDeleteChat only ever runs after an explicit confirm. This repo
// has no jsdom/@testing-library, so this asserts the guarded wiring directly against the source
// (see tests/client/model-popup-manual-pin.test.cjs for the same approach elsewhere in this suite).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectView.tsx'), 'utf8');

test('the recents-del button no longer calls onDeleteChat directly on click', () => {
  const buttonMatch = src.match(/className="recents-del"[\s\S]*?<\/button>/);
  assert.ok(buttonMatch, 'expected to find the chat-list delete button');
  assert.doesNotMatch(
    buttonMatch[0],
    /onClick=\{\(\) => onDeleteChat\(project\.id, c\.id\)\}/,
    'a bare onClick calling onDeleteChat deletes the chat with a single, unconfirmed click',
  );
  assert.match(
    buttonMatch[0],
    /onClick=\{\(\) => setConfirmDeleteChat\(\{ id: c\.id, title: c\.title \|\| t\('sidebar\.thisChat'\) \}\)\}/,
    'the click should stage a confirmation instead of deleting immediately',
  );
});

test('a confirmDeleteChat state holds the staged chat, mirroring the existing confirmDelete/confirmImageDelete pattern', () => {
  assert.match(src, /const \[confirmDeleteChat, setConfirmDeleteChat\] = useState<\{ id: string; title: string \} \| null>\(null\);/);
});

test('the ConfirmDialog only calls onDeleteChat once the user confirms, and clears the staged state first', () => {
  const dialogMatch = src.match(/\{confirmDeleteChat && \(\s*<ConfirmDialog[\s\S]*?\/>\s*\)\}/);
  assert.ok(dialogMatch, 'expected a ConfirmDialog gated on confirmDeleteChat');
  assert.match(dialogMatch[0], /onCancel=\{\(\) => setConfirmDeleteChat\(null\)\}/);
  assert.match(
    dialogMatch[0],
    /onConfirm=\{\(\) => \{ const chatId = confirmDeleteChat\.id; setConfirmDeleteChat\(null\); onDeleteChat\(project\.id, chatId\); \}\}/,
  );
  assert.match(dialogMatch[0], /danger/, 'a permanent delete should render as the danger action');
});

test('the confirm dialog reuses the sidebar\'s own delete-chat copy rather than inventing new strings', () => {
  const dialogMatch = src.match(/\{confirmDeleteChat && \(\s*<ConfirmDialog[\s\S]*?\/>\s*\)\}/)[0];
  assert.match(dialogMatch, /t\('sidebar\.confirmDeleteChatTitle', \{ name: confirmDeleteChat\.title \}\)/);
  assert.match(dialogMatch, /t\('sidebar\.confirmDeleteChatBody'\)/);
  assert.match(dialogMatch, /t\('sidebar\.deleteChat'\)/);
});

test('those sidebar.* keys this dialog borrows are defined in the English base catalogue', () => {
  const enGB = fs.readFileSync(path.join(__dirname, '../../src/i18n/en-GB.ts'), 'utf8');
  for (const key of ['sidebar.confirmDeleteChatTitle', 'sidebar.confirmDeleteChatBody', 'sidebar.deleteChat', 'sidebar.thisChat']) {
    assert.match(enGB, new RegExp(`'${key.replace(/[.]/g, '\\.')}':`), `${key} defined in en-GB.ts`);
  }
});
