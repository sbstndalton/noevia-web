// #1535: the Laya routing rows read "Fast · Greetings…" (a space after the dot, not before), and a
// wrapped description hangs under the description column instead of returning to the label column.
// Renders RoutingDetails through Vite's SSR pipeline (same technique as message-actions-render) and
// checks the markup and the rule that lays the two columns out.
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

const decision = {
  offered: [{ id: 'fast', label: 'Fast model' }, { id: 'code', label: 'Code model' }],
  scores: { fast: 0.5, code: 0.25 },
  selectedRole: 'fast',
  effectiveRole: 'fast',
  backend: 'decision-service',
  model: 'convaiinnovations/laya',
  calibrated: false,
  latencyMs: 12,
  status: 'accepted',
  fallbackReason: null,
};

test('#1535 each routing option reads "Role · description" with a space after the dot', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { RoutingDetails } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(RoutingDetails, { decision }));
    // The option list only (the summary and the note use the same dot for other things): the text as
    // a reader sees it, with no space before the dot and one space after it.
    const list = /<ul>[\s\S]*?<\/ul>/.exec(html);
    assert.ok(list, 'the offered options are rendered as a list');
    const text = list[0].replace(/<[^>]+>/g, '');
    assert.doesNotMatch(text, / ·/, 'no space before the separator dot');
    assert.doesNotMatch(text, /·[A-Za-z]/, 'a space follows the separator dot');
    assert.match(text, /Fast· \S/, 'the label is followed by the dot and then the description');
    assert.match(list[0], /<span class="route-option"><strong>[^<]+<\/strong><span class="route-option-desc">· [^<]+<\/span><\/span>/);
  });
});

test('#1535 the two columns are a grid, and the description column is the one that wraps', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/noevia.css'), 'utf8');
  const rule = /\.routing-details-body \.route-option \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'a .route-option grid rule exists');
  assert.match(rule[1], /display:\s*grid/);
  assert.match(rule[1], /grid-template-columns:\s*max-content minmax\(0,\s*1fr\)/);
  // The label column does not stretch and the description column may shrink, so wrapping stays in it.
  assert.match(css, /\.routing-details-body \.route-option-desc \{[^}]*min-width:\s*0/);
});
