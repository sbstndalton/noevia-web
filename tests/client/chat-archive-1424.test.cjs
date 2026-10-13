'use strict';
// #1424: an archived chat is never pinned. Archiving takes the pin away; undo of a quick archive puts back the
// pin the chat had; restoring from the Archived page returns the chat unpinned.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { archivePatch, undoArchivePatch, restorePatch } = require('../../src/chat-archive.ts');

test('archiving a pinned or unpinned chat always leaves it archived and unpinned', () => {
  assert.deepEqual(archivePatch(), { archived: true, pinned: false });
});

test('undo of a quick archive restores the pin the chat had before archiving', () => {
  assert.deepEqual(undoArchivePatch({ pinned: true }), { archived: false, pinned: true });
  assert.deepEqual(undoArchivePatch({ pinned: false }), { archived: false, pinned: false });
  assert.deepEqual(undoArchivePatch({}), { archived: false, pinned: false });
});

test('restoring from the Archived page returns the chat unpinned, even if it was archived while pinned', () => {
  assert.deepEqual(restorePatch(), { archived: false, pinned: false });
});
