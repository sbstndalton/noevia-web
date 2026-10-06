'use strict';
// #393: an unsent composer draft must be scoped to the chat it was typed in — never carried
// into whichever chat is opened next — while still being restorable if you come back to the
// same chat (or reload the page) later. See src/chat-drafts.ts for the storage format and
// src/components/ChatView.tsx for where these are called from.
const test = require('node:test');
const assert = require('node:assert/strict');

/** A minimal in-memory localStorage, since these tests run under plain Node, not jsdom. */
function fakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    get size() { return store.size; },
  };
}

function freshModule() {
  global.localStorage = fakeLocalStorage();
  // Each test gets its own module instance (and its own fake storage) so drafts from one
  // test can never leak into another via Node's require cache.
  delete require.cache[require.resolve('../../src/chat-drafts.ts')];
  return require('../../src/chat-drafts.ts');
}

test('a chat with no saved draft reads back empty', () => {
  const { readDraft } = freshModule();
  assert.equal(readDraft('chat-a'), '');
});

test('a saved draft is read back for the same chat only', () => {
  const { readDraft, writeDraft } = freshModule();
  writeDraft('chat-a', 'unsent text for A');
  writeDraft('chat-b', 'unsent text for B');
  assert.equal(readDraft('chat-a'), 'unsent text for A');
  assert.equal(readDraft('chat-b'), 'unsent text for B');
  // The chat this test's title warns about never having its draft show up elsewhere.
  assert.notEqual(readDraft('chat-a'), readDraft('chat-b'));
});

test('a brand new chatId never inherits another chat\'s draft', () => {
  const { readDraft, writeDraft } = freshModule();
  writeDraft('chat-a', 'AUDIT bleed test unique marker ZQX77 DO NOT SEND');
  assert.equal(readDraft('c-freshly-created-chat'), '');
});

test('clearDraft removes only that chat\'s entry', () => {
  const { readDraft, writeDraft, clearDraft } = freshModule();
  writeDraft('chat-a', 'draft A');
  writeDraft('chat-b', 'draft B');
  clearDraft('chat-a');
  assert.equal(readDraft('chat-a'), '');
  assert.equal(readDraft('chat-b'), 'draft B');
});

test('writing an empty string clears the draft instead of storing a blank entry', () => {
  const { readDraft, writeDraft } = freshModule();
  writeDraft('chat-a', 'something');
  writeDraft('chat-a', '');
  assert.equal(readDraft('chat-a'), '');
});

test('clearing a chat with no draft, or a falsy chatId, is a harmless no-op', () => {
  const { readDraft, writeDraft, clearDraft } = freshModule();
  assert.doesNotThrow(() => clearDraft('never-written'));
  assert.doesNotThrow(() => writeDraft('', 'ignored'));
  assert.doesNotThrow(() => clearDraft(''));
  assert.equal(readDraft(''), '');
});

test('a single draft is capped in length rather than growing without bound', () => {
  const { readDraft, writeDraft } = freshModule();
  const huge = 'x'.repeat(50_000);
  writeDraft('chat-a', huge);
  const stored = readDraft('chat-a');
  assert.ok(stored.length < huge.length, 'an oversized draft is truncated, not stored whole');
  assert.ok(stored.length > 0);
});

test('the number of retained drafts is capped, evicting the least-recently-touched chat first', () => {
  const { readDraft, writeDraft } = freshModule();
  for (let i = 0; i < 60; i++) writeDraft(`chat-${i}`, `draft ${i}`);
  // The earliest-written chats should have been evicted; the most recent ones remain.
  assert.equal(readDraft('chat-0'), '');
  assert.equal(readDraft('chat-59'), 'draft 59');
});

test('touching an old chat again protects it from eviction ahead of chats untouched since', () => {
  const { readDraft, writeDraft } = freshModule();
  for (let i = 0; i < 50; i++) writeDraft(`chat-${i}`, `draft ${i}`);
  writeDraft('chat-0', 'freshly re-touched'); // now the most recently touched
  for (let i = 50; i < 55; i++) writeDraft(`chat-${i}`, `draft ${i}`);
  assert.equal(readDraft('chat-0'), 'freshly re-touched', 're-touching a chat must renew it, not just insert a duplicate entry');
});

test('corrupt or non-object storage is treated as no drafts saved, not a thrown error', () => {
  global.localStorage = fakeLocalStorage();
  global.localStorage.setItem('noevia:chat-drafts', 'not json');
  delete require.cache[require.resolve('../../src/chat-drafts.ts')];
  const { readDraft, writeDraft } = require('../../src/chat-drafts.ts');
  assert.equal(readDraft('chat-a'), '');
  assert.doesNotThrow(() => writeDraft('chat-a', 'recovers fine'));
  assert.equal(readDraft('chat-a'), 'recovers fine');
});

test('storage being unavailable (thrown getItem/setItem) never throws out of the helpers', () => {
  global.localStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  delete require.cache[require.resolve('../../src/chat-drafts.ts')];
  const { readDraft, writeDraft, clearDraft } = require('../../src/chat-drafts.ts');
  assert.doesNotThrow(() => writeDraft('chat-a', 'text'));
  assert.equal(readDraft('chat-a'), '');
  assert.doesNotThrow(() => clearDraft('chat-a'));
});
