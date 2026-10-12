// #1474: a bare https URL in an assistant reply was plain text; only [text](url) became a link. Chat replies
// now autolink bare http(s) URLs the way GitHub-flavoured Markdown does, with the same safe link attributes as
// an explicit link. The Diary renders the same text as before (no autolink), and only http(s) is linked.
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('#1474 splitUrlTail keeps sentence punctuation and unmatched brackets out of the link', async () => {
  await withSsr(async (server) => {
    const { splitUrlTail } = await server.ssrLoadModule('/src/components/DiaryModal.tsx');
    assert.deepEqual(splitUrlTail('https://example.net.'), { url: 'https://example.net', tail: '.' });
    assert.deepEqual(splitUrlTail('https://example.net/x?a=1,'), { url: 'https://example.net/x?a=1', tail: ',' });
    assert.deepEqual(splitUrlTail('https://example.com/a_(b))'), { url: 'https://example.com/a_(b)', tail: ')' });
    assert.deepEqual(splitUrlTail('https://example.com/a_(b)'), { url: 'https://example.com/a_(b)', tail: '' });
    assert.deepEqual(splitUrlTail('https://example.net/'), { url: 'https://example.net/', tail: '' });
  });
});

test('#1474 a bare URL becomes a safe link; the explicit link is unchanged; the full stop stays text', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MarkdownPreview } = await server.ssrLoadModule('/src/components/DiaryModal.tsx');
    const html = renderToStaticMarkup(React.createElement(MarkdownPreview, {
      autolink: true,
      text: '4\n\n[explicit link](https://example.org)\n\nthe bare URL https://example.net. And https://example.com/a_(b).',
    }));
    assert.match(html, /<a href="https:\/\/example\.org" target="_blank" rel="noopener noreferrer nofollow">explicit link<\/a>/);
    assert.match(html, /<a href="https:\/\/example\.net" target="_blank" rel="noopener noreferrer nofollow">https:\/\/example\.net<\/a>\./);
    assert.match(html, /<a href="https:\/\/example\.com\/a_\(b\)" target="_blank" rel="noopener noreferrer nofollow">https:\/\/example\.com\/a_\(b\)<\/a>\./);
    const anchors = [...html.matchAll(/<a [^>]*>/g)].length;
    assert.equal(anchors, 3, 'exactly the three links, no duplicate inside the explicit one');
  });
});

test('#1474 without autolink (the Diary) a bare URL stays plain text, as before', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MarkdownPreview } = await server.ssrLoadModule('/src/components/DiaryModal.tsx');
    const html = renderToStaticMarkup(React.createElement(MarkdownPreview, { text: 'see https://example.net today' }));
    assert.doesNotMatch(html, /<a /);
    assert.match(html, /see https:\/\/example\.net today/);
  });
});

test('#1474 only http and https become links: a javascript: or data: URL is never an anchor', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MarkdownPreview } = await server.ssrLoadModule('/src/components/DiaryModal.tsx');
    const html = renderToStaticMarkup(React.createElement(MarkdownPreview, { autolink: true, text: 'try javascript:alert(1) or data:text/html,hi' }));
    assert.doesNotMatch(html, /<a /);
    assert.doesNotMatch(html, /href="javascript:|href="data:/);
  });
});
