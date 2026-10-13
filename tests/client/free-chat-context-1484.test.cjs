'use strict';
// #1484: opening a chat (or a Settings route over it) must not POST /api/chats/<id>/context. That POST
// creates the chat's attachments project, so every opened or unused chat id left an orphan behind. The
// read is a GET; the project is created on the first composer action (the + menu, or a file dropped on
// the chat), and a menu opened over a free chat is not closed by the project it just created.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chatSrc = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');
const actionsSrc = fs.readFileSync(path.join(__dirname, '../../src/components/ComposerActions.tsx'), 'utf8');

function between(src, start, end) {
  const from = src.indexOf(start);
  assert.notEqual(from, -1, `missing: ${start}`);
  const to = src.indexOf(end, from);
  assert.notEqual(to, -1, `missing end: ${end}`);
  return src.slice(from, to);
}

test('the chat-open effect reads the free chat context with GET and never POSTs', () => {
  const effect = between(chatSrc, '  useEffect(() => {\n    setFreeContext(null);', '  }, [chatId, project?.id]);');
  assert.match(effect, /apiFetch\(`\/api\/chats\/\$\{encodeURIComponent\(chatId\)\}\/context`\)/);
  assert.doesNotMatch(effect, /method: 'POST'/);
});

test('only ensureFreeContext creates the context, and it is shared while in flight', () => {
  const ensure = between(chatSrc, '  const ensureInFlight = useRef', '  // Every chat with work in flight');
  assert.match(ensure, /apiFetch\(`\/api\/chats\/\$\{encodeURIComponent\(forChat\)\}\/context`, \{ method: 'POST' \}\)/);
  assert.match(ensure, /if \(ensureInFlight\.current\?\.chatId === forChat\) return ensureInFlight\.current\.promise;/);
  assert.match(ensure, /statusOf\(forChat, String\(err instanceof Error \? err\.message : err\)\); return null;/, 'a failure lands on this chat status line, not a thrown error');
  assert.equal((chatSrc.match(/\{ method: 'POST' \}\)/g) || []).length, 1, 'ChatView has exactly one context POST');
});

test('ChatView hands the ensure step to the composer menu and to the chat-pane drop', () => {
  assert.match(chatSrc, /ensureProject: project \? undefined : ensureFreeContext,/);
  assert.match(chatSrc, /onEnsureProject=\{project \? undefined : ensureFreeContext\}/);
});

test('the + button creates the project on open when there is none, without blocking the menu', () => {
  assert.match(actionsSrc, /onClick=\{\(\) => \{ if \(!open && !project\) void onEnsureProject\?\.\(\); setOpen\(!open\); \}\}/);
});

test('the menu stays open when a free chat gets its project (null to id), but closes on a switch between projects', () => {
  const effect = between(actionsSrc, '  const shownProjectId = useRef', '  useEffect(() => {\n    if (!open) return;\n    let active = true;');
  assert.match(effect, /if \(!diary && !\(previous === null && project\?\.id\)\) setOpen\(false\);/);
});
