'use strict';
// #1528: ArrowDown/ArrowUp move focus between the chat rows of the recent-chat list (Tab keeps
// working as before). Source-contract checks on Sidebar.tsx, as in sidebar-focus-and-undo.test.cjs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');

test('ArrowDown/ArrowUp move focus between chat rows of the chat list, and Tab still works (#1528)', () => {
  const handler = src.slice(src.indexOf('const onChatListKeyDown'), src.indexOf('const onChatListKeyDown') + 800);
  assert.match(handler, /if \(e\.defaultPrevented \|\| \(e\.key !== 'ArrowDown' && e\.key !== 'ArrowUp'\)\) return;/);
  assert.match(handler, /current\.matches\('\.chat-row > \.nav-item'\)/);
  assert.match(handler, /querySelectorAll<HTMLElement>\('\.chat-row > \.nav-item'\)/);
  assert.match(handler, /filter\(\(el\) => el\.getClientRects\(\)\.length\)/);
  assert.match(handler, /rows\[index \+ \(e\.key === 'ArrowDown' \? 1 : -1\)\]\?\.focus\(\);/);
  assert.match(handler, /e\.preventDefault\(\);/);
});

test('the arrow handler is wired on the recent-chat list only (#1528)', () => {
  assert.match(src, /<div className="sidebar-history" onKeyDown=\{onChatListKeyDown\}>/);
  assert.equal((src.match(/onKeyDown=\{onChatListKeyDown\}/g) || []).length, 1);
});
