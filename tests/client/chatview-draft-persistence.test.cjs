'use strict';
// #393: an unsent composer draft must be scoped to the chat it was typed in — switching to a
// different chat (even mid-render, since ChatView is intentionally not remounted on chat switch;
// see the comment above the `[chatId]` effect) must never carry the previous chat's text along,
// and returning to a chat should restore whatever was left there. The initial-mount half of this
// (seeding `draft` from chat-drafts.ts) is exercised for real below by rendering ChatView itself,
// the same SSR technique tests/client/message-actions-render.test.cjs uses. The live-switch half (the
// same mounted ChatView instance receiving a new `chatId` prop without remounting) can't run
// through an actual effect pass without jsdom (see tests/client/account-menu-a11y.test.cjs's note on
// this repo having none), so it is pinned at the source level instead, the same way
// tests/client/chatview-edit-actions.test.cjs pins the non-renderable edit-cancel/focus contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readDraft, writeDraft } = require('../../src/chat-drafts.ts');

async function withSsr(run) {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: path.resolve(__dirname, '../..'),
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {} }, cookie: '' };
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-US', languages: ['en-US'], clipboard: { writeText: () => Promise.resolve() } }, configurable: true, writable: true });
  try {
    await run(server);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

function baseProps(chatId) {
  return {
    project: null,
    onProjectChanged: () => {},
    title: 'Chat', projectName: null, modelLabel: 'Auto',
    installedModels: [], messages: [], streaming: false, inferenceUp: null,
    onSend: () => {}, onRetry: () => {}, onRegenerate: () => {}, onEditMessage: () => {},
    chatId, onStop: () => {}, onBack: null, onOpenModels: () => {}, onOpenSettings: () => {},
  };
}

test('mounting on a chat with a saved draft shows that draft, and mounting on a different chat never shows it', async () => {
  await withSsr(async (server) => {
    writeDraft('chat-a', 'AUDIT bleed test unique marker ZQX77 DO NOT SEND');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ChatView } = await server.ssrLoadModule('/src/components/ChatView.tsx');

    const htmlA = renderToStaticMarkup(React.createElement(ChatView, baseProps('chat-a')));
    assert.match(htmlA, /ZQX77/, "chat-a's own saved draft should be restored into its composer");

    const htmlB = renderToStaticMarkup(React.createElement(ChatView, baseProps('chat-b')));
    assert.doesNotMatch(htmlB, /ZQX77/, "a different, unrelated chat must never show chat-a's draft");
  });
});

test('a brand-new chatId (a chat nobody has typed into yet) always mounts with an empty composer', async () => {
  await withSsr(async (server) => {
    writeDraft('chat-with-history', 'some earlier unsent text');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ChatView } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(ChatView, baseProps('c-freshly-created-chat')));
    assert.doesNotMatch(html, /some earlier unsent text/);
    assert.equal(readDraft('c-freshly-created-chat'), '');
  });
});

// The live (no-remount) chat switch: verified at the source level, per the file banner above.
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');

test('draft state is seeded from this chat\'s own saved draft on mount', () => {
  assert.match(src, /const \[draft, setDraft\] = useState\(\(\) => readDraft\(chatId\)\)/);
});

test('switching chatId (without remounting) reloads the newly-opened chat\'s own draft, in the same effect that already clears in-progress edit state', () => {
  const effect = src.slice(src.indexOf('// An in-progress edit must not survive switching chats.'), src.indexOf('const openModels ='));
  assert.match(effect, /setEditingId\(null\)/);
  assert.match(effect, /setEditDraft\(''\)/);
  assert.match(effect, /setDraft\(readDraft\(chatId\)\)/);
  assert.match(effect, /\}, \[chatId\]\)/);
});

test('every keystroke persists the draft under the chat it was typed in, not a later chatId', () => {
  const onDraftFn = src.slice(src.indexOf('const onDraft = '), src.indexOf('const submit = '));
  assert.match(onDraftFn, /writeDraft\(chatId, value\)/);
});

test('a mention inserted from the tool catalogue is persisted immediately too, not only on the next keystroke', () => {
  assert.match(src, /onMention=\{name => \{ const next = insertMention\(draft, name\); setDraft\(next\); writeDraft\(chatId, next\); \}\}/);
});

test('sending clears the draft so a sent chat does not keep offering stale text back on return', () => {
  const submitStart = src.indexOf('const submit = ');
  const submitFn = src.slice(submitStart, src.indexOf('return (', submitStart));
  assert.match(submitFn, /setDraft\(''\)/);
  assert.match(submitFn, /clearDraft\(chatId\)/);
});

test('ChatView is intentionally not remounted per chat (no key={chatId}) in App.tsx, so this file must keep resetting per-chat state itself rather than relying on a fresh instance', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  const chatViewUsage = app.slice(app.indexOf('<ChatView'), app.indexOf('chatId={view.chatId}') + 40);
  assert.doesNotMatch(chatViewUsage, /key=\{[^}]*chatId/, 'a key={chatId} would remount ChatView on every chat switch, dropping scroll position, in-flight streaming state and the fix in this file for #393 would no longer be exercised the same way');
});
