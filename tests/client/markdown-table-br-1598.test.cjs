// #1598: a `<br>` inside a comparison-table cell showed as the literal text "<br>". In a cell it is now a line
// break. The cell text is still React-escaped: `<br>` is the only tag that reaches the page, and any other
// markup in a cell stays visible text. No raw HTML is injected.
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

async function renderChat(server, text) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MarkdownPreview } = await server.ssrLoadModule('/src/components/DiaryModal.tsx');
  return renderToStaticMarkup(React.createElement(MarkdownPreview, { autolink: true, text }));
}

test('#1598 a <br> in a table cell is a line break, not visible text', async () => {
  await withSsr(async (server) => {
    const html = await renderChat(server, [
      '| Version | Top 3 breaking changes |',
      '| --- | --- |',
      '| PostgreSQL 17 | 1. Dropped a thing<br>2. Changed a thing<br/>3. New default<br />end |',
    ].join('\n'));
    assert.doesNotMatch(html, /&lt;br/i, 'no literal <br> text is left in the cell');
    assert.match(html, /<td>1\. Dropped a thing<br\/>2\. Changed a thing<br\/>3\. New default<br\/>end<\/td>/);
  });
});

test('#1598 <BR> in a header cell and an uppercase tag are line breaks too', async () => {
  await withSsr(async (server) => {
    const html = await renderChat(server, ['| First<BR>line | Second |', '| --- | --- |', '| a | b |'].join('\n'));
    assert.doesNotMatch(html, /&lt;br/i);
    assert.match(html, /<th>First<br\/>line<\/th>/);
  });
});

test('#1598 other markup in a cell stays escaped text; only the line break is a tag', async () => {
  await withSsr(async (server) => {
    const html = await renderChat(server, [
      '| Cell |',
      '| --- |',
      '| <script>alert(1)</script><img src=x onerror=alert(1)>a<br><b>bold?</b> |',
    ].join('\n'));
    assert.doesNotMatch(html, /<script|<img|<b>/, 'no injected element');
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;a<br\/>&lt;b&gt;bold\?&lt;\/b&gt;/);
  });
});
