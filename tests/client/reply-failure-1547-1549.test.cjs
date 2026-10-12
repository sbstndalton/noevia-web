// #1547: a failed reply said "Partial output was preserved" under a bubble that showed no partial text.
// #1549: the failure was green monospace, the same look as the reply body and the accent colour of success.
// The failed reply now shows what streamed in, marked incomplete, and the failure as an inline error card
// in the interface font. Rendered through Vite's SSR pipeline like message-actions-render.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

async function withSsr(run) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({
    configFile: false,
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'], clipboard: { writeText: () => Promise.resolve() } };
  try {
    await run(server);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('#1547 partial text is shown above the failure, labelled incomplete', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { FailedReply } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(FailedReply, {
      partial: 'Here is the start of the answer.', failure: 'Cannot reach noevia. Check your connection and try again.',
      canRetry: true, disabled: false, onRetry: () => {},
    }));
    assert.match(html, /data-testid="reply-partial"/);
    assert.match(html, /Incomplete reply/);
    assert.match(html, /Here is the start of the answer\./, 'the streamed text is on screen');
    assert.match(html, /data-testid="reply-failure"/);
    assert.match(html, /role="alert"/);
    // The partial text comes before the failure in reading order.
    assert.ok(html.indexOf('Here is the start') < html.indexOf('Cannot reach noevia'), 'partial above failure');
  });
});

test('#1547 with nothing streamed there is no partial block, and no claim that output was kept', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { FailedReply } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(FailedReply, {
      partial: '', failure: 'The model stopped before it finished. Check the backend, then try again.',
      canRetry: true, disabled: false, onRetry: () => {},
    }));
    assert.doesNotMatch(html, /reply-partial/);
    assert.doesNotMatch(html, /preserved/i);
    assert.match(html, /The model stopped before it finished/);
  });
});

test('#1547 Retry is offered on the last reply only, and disabled while busy', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { FailedReply } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const notLast = renderToStaticMarkup(React.createElement(FailedReply, { partial: '', failure: 'x', canRetry: false, disabled: false, onRetry: () => {} }));
    assert.doesNotMatch(notLast, /msg-retry/);
    const busy = renderToStaticMarkup(React.createElement(FailedReply, { partial: '', failure: 'x', canRetry: true, disabled: true, onRetry: () => {} }));
    assert.match(busy, /<button class="msg-retry"[^>]*disabled/);
  });
});

test('#1549 the failure is not the green reply-body style; it is an error card in the interface font', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { FailedReply } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(FailedReply, { partial: '', failure: 'Cannot reach noevia.', canRetry: true, disabled: false, onRetry: () => {} }));
    assert.doesNotMatch(html, /accent-text/, 'no inline accent green');
    assert.doesNotMatch(html, /<p style=/, 'no inline style on the failure');
    assert.match(html, /<div class="msg-failure" role="alert"[^>]*>/);
    assert.match(html, /<span class="msg-failure-icon" aria-hidden="true">!<\/span>/, 'the failure has its own mark');
  });
});
