'use strict';
// #1471: a chat can be exported from its own menu. The menu item calls downloadChatExport, which fetches the
// one-chat Markdown file, names it from the server's Content-Disposition and reports a failure with the
// server's own sentence. Synthetic chat only; the fetch is a fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sidebar = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');

test('the chat options menu has an export item that downloads this chat, next to Rename', () => {
  const from = sidebar.indexOf('const chatMenu = (c: ChatMeta)');
  const menu = sidebar.slice(from, sidebar.indexOf("label: t('sidebar.archive')", from));
  assert.match(menu, /label: t\('sidebar\.exportChat'\)/);
  assert.match(menu, /onSelect: \(\) => void downloadChatExport\(c\.id\)\.catch\(/);
  assert.match(menu, /setConfirm\(\{[\s\S]*title: t\('sidebar\.exportChatFailedTitle'\)/, 'a failed export is reported, not swallowed');
  assert.ok(menu.indexOf("sidebar.exportChat'") > menu.indexOf("sidebar.rename'"), 'the export item follows Rename');
});

test('every locale catalogue has the export menu strings', () => {
  for (const locale of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const text = fs.readFileSync(path.join(__dirname, `../../src/i18n/${locale}.ts`), 'utf8');
    for (const key of ['sidebar.exportChat', 'sidebar.exportChatFailedTitle', 'sidebar.exportChatFailedOk']) assert.match(text, new RegExp(`'${key.replace(/\./g, '\\.')}':`), `${locale} is missing ${key}`);
  }
});

async function withExport(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  const saved = { fetch: globalThis.fetch, document: globalThis.document, URL: globalThis.URL, window: globalThis.window };
  const clicks = [];
  let responder = () => new Response('', { status: 200 });
  globalThis.fetch = async (input) => responder(String(input));
  globalThis.document = { cookie: '', createElement: () => ({ click() { clicks.push(this.download); } }) };
  globalThis.window = { setTimeout: () => 0 };
  globalThis.URL = Object.assign(function URLShim(...args) { return new saved.URL(...args); }, saved.URL, { createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => {} });
  try {
    const mod = await server.ssrLoadModule('/src/chat-export.ts');
    return await fn({ mod, clicks, setResponder: (r) => { responder = r; } });
  } finally {
    Object.assign(globalThis, { fetch: saved.fetch, document: saved.document, URL: saved.URL, window: saved.window });
    if (saved.document === undefined) delete globalThis.document;
    if (saved.window === undefined) delete globalThis.window;
    await server.close();
  }
}

test('a chat downloads as the Markdown file the server names, encoded by chat id', () => withExport(async ({ mod, clicks, setResponder }) => {
  const seen = [];
  setResponder((url) => { seen.push(url); return new Response('# Synthetic\n', { status: 200, headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="noevia-chat-synthetic-c1.md"' } }); });
  const name = await mod.downloadChatExport('c 1/x');
  assert.equal(name, 'noevia-chat-synthetic-c1.md');
  assert.deepEqual(seen, ['/api/chats/c%201%2Fx/export']);
  assert.deepEqual(clicks, ['noevia-chat-synthetic-c1.md']);
}));

test('a refused export throws the server sentence and downloads nothing', () => withExport(async ({ mod, clicks, setResponder }) => {
  setResponder(() => new Response(JSON.stringify({ error: 'This chat was not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(mod.downloadChatExport('gone'), /This chat was not found\./);
  assert.deepEqual(clicks, []);
}));

test('an answer that is not a Markdown chat is refused, not saved as a file', () => withExport(async ({ mod, clicks, setResponder }) => {
  setResponder(() => new Response('<html>sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(mod.downloadChatExport('c1'), /something other than a chat/);
  assert.deepEqual(clicks, []);
}));
