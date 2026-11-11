'use strict';
// sbstndalton/noevia#2399: the sidebar says so when a search query is over the server's 200-character limit, and when the
// server cut the message-text matches short (truncated). Browser proof: qa/search-limits-2399.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const sidebar = read('src/components/Sidebar.tsx');

test('noevia#2399 the client limit is the one the server enforces', () => {
  const core = path.join(__dirname, '../../../noevia-core/server/routes/chat-lists.cjs');
  assert.match(read('src/sidebar-search.ts'), /export const SEARCH_MAX_QUERY = 200;/);
  if (fs.existsSync(core)) assert.match(fs.readFileSync(core, 'utf8'), /SEARCH_MAX_QUERY = 200/, 'noevia-core still caps a query at 200');
});

test('noevia#2399 a too-long query is not sent and does not read as "no matches"', () => {
  assert.match(sidebar, /const queryTooLong = textQuery\.length > SEARCH_MAX_QUERY;/);
  assert.match(sidebar, /if \(textQuery\.length < 2 \|\| queryTooLong\) \{ setTextHits\(null\); return; \}/);
  assert.match(sidebar, /query && !queryTooLong && searchResults\.length === 0/);
  assert.equal((sidebar.match(/t\('sidebar\.searchTooLong', \{ max: SEARCH_MAX_QUERY \}\)/g) || []).length, 2, 'chat and Code lists both say the limit');
});

test('noevia#2399 the truncated flag from the server is kept and shown', () => {
  assert.match(sidebar, /setTextHits\(\{ query: textQuery, ids: new Set\(r\.chats\), truncated: r\.truncated \}\)/);
  assert.match(sidebar, /\{messageHitsTruncated && <p className="side-hint" role="status">\{t\('sidebar\.searchTruncated'\)\}<\/p>\}/);
});

test('noevia#2399 every locale words both notes, and the limit fills in', () => {
  for (const locale of LOCALES) {
    const c = catalogue(locale);
    assert.match(c['sidebar.searchTooLong'] || '', /\{max\}/, `${locale}: searchTooLong takes {max}`);
    assert.ok(c['sidebar.searchTruncated'], `${locale}: searchTruncated`);
  }
});
