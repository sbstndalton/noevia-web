'use strict';
// #1450: the sidebar search also finds chats by their message text (the server reads the transcripts; the
// sidebar only has titles). The text search waits a moment after typing, needs two characters, is kept only
// for the query it answered, and is left out of a #tag query. Source contract on the wiring; the server side
// is core's chat-lists route tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sidebar = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');

test('the client asks the server for message-text matches, encoded, and keeps only the answer for the current query', () => {
  assert.match(api, /export function searchChatText\(text: string\): Promise<\{ chats: string\[\]; truncated: boolean \}> \{/);
  assert.match(api, /getJson<\{ chats: string\[\]; truncated: boolean \}>\(`\/api\/chats\/search\?q=\$\{encodeURIComponent\(text\)\}`\)/);
  assert.match(sidebar, /if \(textQuery\.length < 2\) \{ setTextHits\(null\); return; \}/);
  assert.match(sidebar, /window\.setTimeout\(\(\) => \{[\s\S]*?searchChatText\(textQuery\)[\s\S]*?\}, 300\);/);
  assert.match(sidebar, /if \(live\) setTextHits\(\{ query: textQuery, ids: new Set\(r\.chats\) \}\);/);
  assert.match(sidebar, /const messageHits = !tagQuery && textHits && textHits\.query === textQuery \? textHits\.ids : null;/);
});

test('a chat found by its message text joins the sidebar list, and archived chats still stay out', () => {
  const visible = sidebar.slice(sidebar.indexOf('const visibleChats = recentChats(chats)'), sidebar.indexOf('const tags = organise ? tagTree(chats) : [];'));
  assert.match(visible, /\|\| !!messageHits\?\.has\(c\.id\)\)/);
  assert.match(visible, /recentChats\(chats\)/, 'the list it filters is still the non-archived sidebar list');
});

test('a late answer for an old query is ignored by the cleanup, and failures clear the matches', () => {
  assert.match(sidebar, /return \(\) => \{ live = false; window\.clearTimeout\(timer\); \};/);
  assert.match(sidebar, /\.catch\(\(\) => \{ if \(live\) setTextHits\(null\); \}\);/);
});
