// #1593: a Task/Cowork start that failed showed its sentence twice, first as an "Incomplete" partial reply
// and then again in the failure card. Renders the real ChatView with the message the start-failure path builds.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withSsr(run) {
  const { createServer } = require('./vite-ssr-server.cjs');
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
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'], clipboard: { writeText: () => Promise.resolve() } }, configurable: true, writable: true });
  try { await run(server); } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

function props(messages) {
  return {
    project: null, onProjectChanged: () => {}, title: 'Chat', projectName: null, modelLabel: 'Auto',
    installedModels: [], messages, streaming: false, inferenceUp: null,
    onSend: () => {}, onRetry: () => {}, onRegenerate: () => {}, onEditMessage: () => {},
    chatId: 'c-1593', onStop: () => {}, onBack: null, onOpenModels: () => {}, onOpenSettings: () => {},
  };
}

const count = (html, needle) => html.split(needle).length - 1;

test('a failed Task start shows its sentence once, in the failure card, with no Incomplete partial', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ChatView } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const { coworkStartFailure } = await server.ssrLoadModule('/src/failure-copy.ts');
    const sentence = 'Cowork task did not start — repository not found';
    const reply = { id: 'a1', role: 'assistant', senderLabel: 'Cowork', ...coworkStartFailure(sentence, 'acme/app') };
    const html = renderToStaticMarkup(React.createElement(ChatView, props([{ id: 'u1', role: 'user', content: 'fix it' }, reply])));
    assert.equal(count(html, 'repository not found'), 1, 'the reason appears once');
    assert.doesNotMatch(html, /reply-partial/);
    assert.doesNotMatch(html, /Incomplete/);
    assert.match(html, /data-testid="reply-failure"/);
  });
});

test('a legacy error reply with no failure field never shows its text as partial output', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ChatView } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const reply = { id: 'a1', role: 'assistant', content: 'Cowork task did not start — gone', error: true };
    const html = renderToStaticMarkup(React.createElement(ChatView, props([{ id: 'u1', role: 'user', content: 'x' }, reply])));
    assert.equal(count(html, 'did not start'), 1);
    assert.doesNotMatch(html, /reply-partial/);
  });
});

test('a real partial answer that then failed is still shown as incomplete', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ChatView } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const reply = { id: 'a1', role: 'assistant', content: 'The first half', error: true, failure: 'The model stopped.' };
    const html = renderToStaticMarkup(React.createElement(ChatView, props([{ id: 'u1', role: 'user', content: 'x' }, reply])));
    assert.match(html, /reply-partial/);
    assert.match(html, /The first half/);
  });
});
