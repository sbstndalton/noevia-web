// #1511: "Move to <project>" and "Remove from project" in the chat menu, through the one move path
// (POST /api/chats/:id/move, moveChatToProject). The pure target rule mirrors the server's (#810):
// a project takes chats when it is not archived and has Chat mode. The menu and the App handler are
// checked by source contract, because the menu opens only on a click (the click path is a browser
// check, left unverified here).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

async function loadMove() {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  try {
    return await server.ssrLoadModule('/src/chat-move.ts');
  } finally {
    await server.close();
  }
}

const project = (id, extra = {}) => ({ id, name: id, goal: '', instructions: '', memories: [], files: [], chats: [], createdAt: 0, updatedAt: 0, ...extra });

test('a chat can move into any live project, whatever its stored modes, and not into its own (#1576)', async () => {
  const { chatMoveTargets } = await loadMove();
  const projects = [project('a'), project('b', { modes: ['chat', 'code'] }), project('c', { archived: true }), project('d', { modes: ['cowork'] }), project('e', { modes: [] })];
  // a is the chat’s own project and c is archived; d (once Task-only) and e (empty modes) are chat projects since #1576.
  assert.deepEqual(chatMoveTargets(projects, { projectId: 'a' }).map(p => p.id), ['b', 'd', 'e']);
});

test('a project without a modes list counts as Chat, as the server reads it', async () => {
  const { chatMoveTargets } = await loadMove();
  assert.deepEqual(chatMoveTargets([project('old')], { projectId: null }).map(p => p.id), ['old']);
});

test('a free chat is offered every live Chat project, and nothing is offered when there are none', async () => {
  const { chatMoveTargets } = await loadMove();
  const projects = [project('x'), project('y', { archived: true })];
  assert.deepEqual(chatMoveTargets(projects, { projectId: null }).map(p => p.id), ['x']);
  assert.deepEqual(chatMoveTargets([], { projectId: null }), []);
});

test('the chat menu offers Remove from project for a project chat and Move to <project> for each target', () => {
  const sidebar = read('components/Sidebar.tsx');
  assert.match(sidebar, /onMoveChat\?: \(chatId: string, fromProjectId: string \| null, toProjectId: string \| null\) => void;/);
  assert.match(sidebar, /const chatMoveItems = \(c: ChatMeta\): MenuItem\[\] => \{/);
  assert.match(sidebar, /label: t\('sidebar\.removeFromProject'\)/);
  assert.match(sidebar, /label: t\('sidebar\.moveToProject', \{ name: p\.name \}\)/);
  assert.match(sidebar, /onSelect: \(\) => onMoveChat\(c\.id, from, p\.id\)/);
  assert.match(sidebar, /onSelect: \(\) => onMoveChat\(c\.id, from, null\)/);
  // The menu item is in the chat menu, between Rename and Archive.
  const menu = sidebar.slice(sidebar.indexOf('const chatMenu = '), sidebar.indexOf('const chatMenu = ') + 1200);
  assert.match(menu, /startRename\(c\.id, c\.title \|\| '', menu\?\.source\) \},\n    \.\.\.chatMoveItems\(c\),/);
});

test('the App handler moves through moveChatToProject, queues in the chat’s list, and keeps the frame', () => {
  const app = read('App.tsx');
  const start = app.indexOf('const moveChatTo = useCallback(');
  assert.ok(start > 0, 'moveChatTo exists');
  const body = app.slice(start, app.indexOf('const linkChat = useCallback(', start));
  assert.match(body, /await moveChatToProject\(chatId, toProjectId\);/, 'one move call, with no frame argument');
  assert.match(body, /chatHome\(chatId, allChatsRef\.current, movedChats\.current, fromProjectId\)/, 'queued in the chat’s current list');
  assert.match(body, /chatMetaSaves\.current\.get\(key\)/);
  assert.match(body, /movedChats\.current\.set\(chatId, toProjectId\)/);
  assert.match(body, /setProjectError\(tr\('sidebar\.moveChatFailed'\)\)/);
  assert.match(app, /onMoveChat=\{moveChatTo\}/);
});

test('every catalogue carries the three move strings', () => {
  for (const file of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const src = read(`i18n/${file}.ts`);
    for (const key of ['sidebar.moveToProject', 'sidebar.removeFromProject', 'sidebar.moveChatFailed']) {
      assert.match(src, new RegExp(`'${key.replace('.', '\\.')}'`), `${file} ${key}`);
    }
  }
});
