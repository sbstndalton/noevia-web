// #1537: the Local badge said "sensitivity check is unavailable (http-503)" in the browser's plain tooltip.
// The tooltip is now one plain sentence in the app's styled tooltip (data-tip), and the HTTP code is kept
// only as a data attribute for support.
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

test('#1537 the check-unavailable tooltip is plain language and never shows the HTTP code', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { RouteBadge } = await server.ssrLoadModule('/src/components/RouteControls.tsx');
    const html = renderToStaticMarkup(React.createElement(RouteBadge, { target: { route: 'local', reason: 'check-unavailable', detail: 'http-503' } }));
    assert.match(html, /data-tip="Kept on this device\. The privacy check was unavailable\."/);
    assert.match(html, /aria-label="Kept on this device\. The privacy check was unavailable\."/);
    // Only the words a reader sees (the tooltip and the label), not the support-only data attribute.
    const shown = html.replace(/\sdata-detail="[^"]*"/, '');
    assert.doesNotMatch(shown, /http-503|\(http|sensitivity check/, 'no internal code or check name in the words the reader sees');
    assert.doesNotMatch(html, /\stitle="/, 'the browser title tooltip is gone');
    // The code is still there for support, as a data attribute.
    assert.match(html, /data-detail="http-503"/);
  });
});

test('#1537 other reasons keep the "Sent to …" sentence in the tooltip, with no title attribute', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { RouteBadge } = await server.ssrLoadModule('/src/components/RouteControls.tsx');
    const html = renderToStaticMarkup(React.createElement(RouteBadge, { target: { route: 'cloud', reason: 'user-choice' } }));
    assert.match(html, /data-tip="Sent to Cloud: your choice for this message"/);
    assert.doesNotMatch(html, /data-detail=/);
    assert.doesNotMatch(html, /\stitle="/);
  });
});

test('#1537 the badge tooltip is styled by the app (data-tip on hover), not a browser title', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/noevia.css'), 'utf8');
  assert.match(css, /\.route-badge\[data-tip\]:hover::after \{\s*content: attr\(data-tip\)/);
});

test('#1537 the check-unavailable copy has no {detail} placeholder left in any locale', () => {
  const dir = path.join(ROOT, 'src/i18n');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const line = /'chat\.routing\.reason\.checkUnavailable': "([^"]*)"/.exec(src);
    if (!line) continue;
    assert.doesNotMatch(line[1], /\{detail\}/, `${file} still interpolates the code`);
  }
});
