// #1599: a comparison table wider than its chat column was cut at the right edge. Its box scrolls, but the
// scrollbar is hidden until used and nothing else said so, so the cut text looked like a rendering error.
// The box is now focusable, and an edge fades while more columns lie beyond it (`data-more`, set from the
// measured scroll position). Layout is checked here as the CSS and markup it produces, with the edge logic
// as a pure function; a browser render was checked by hand (see the PR).
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

test('#1599 tableEdges says which side of a wide table still has columns to scroll to', async () => {
  await withSsr(async (server) => {
    const { tableEdges } = await server.ssrLoadModule('/src/components/DiaryModal.tsx');
    assert.equal(tableEdges(0, 742, 816), 'end', 'at the start: more to the right only');
    assert.equal(tableEdges(30, 742, 816), 'start end', 'in the middle: both edges');
    assert.equal(tableEdges(74, 742, 816), 'start', 'scrolled to the end: more to the left only');
    assert.equal(tableEdges(0, 742, 700), '', 'a table that fits has no edge to show');
    assert.equal(tableEdges(0.5, 742, 742.5), '', 'a sub-pixel difference is not overflow');
  });
});

test('#1599 a wide table sits in a focusable scroll box that carries the edge state', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MarkdownPreview } = await server.ssrLoadModule('/src/components/DiaryModal.tsx');
    const html = renderToStaticMarkup(React.createElement(MarkdownPreview, {
      autolink: true,
      text: ['| Protocol | Multiplexing | Header compression | Connection reuse |', '| --- | --- | --- | --- |', '| HTTP/2 | Binary frames, interleaved streams | HPACK | One TCP connection |'].join('\n'),
    }));
    assert.match(html, /<div class="md-table-wrap" tabindex="0">/, 'the scroll box is keyboard focusable');
    assert.match(html, /<table class="md-table">/);
  });
});

test('#1599 the CSS fades the edge that still has columns to scroll to, and shows a focus ring on the box', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/diary-tab.css'), 'utf8');
  assert.match(css, /\.md-table-wrap\[data-more~="end"\]\s*\{[^}]*mask-image:\s*linear-gradient\(to right,\s*currentColor calc\(100% - \d+px\),\s*transparent\)/);
  assert.match(css, /\.md-table-wrap\[data-more~="start"\]\s*\{[^}]*mask-image:\s*linear-gradient\(to right,\s*transparent,\s*currentColor \d+px\)/);
  assert.match(css, /\.md-table-wrap\[data-more~="start"\]\[data-more~="end"\]\s*\{[^}]*mask-image/);
  assert.match(css, /\.md-table-wrap:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/);
  // The fade is alpha only: it names no new colour, so the rule may only use currentColor, never a literal.
  const fadeRules = css.match(/\.md-table-wrap\[data-more[^{]*\{[^}]*\}/g) || [];
  assert.ok(fadeRules.length >= 3);
  for (const rule of fadeRules) assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgba?\(/i, rule);
});
