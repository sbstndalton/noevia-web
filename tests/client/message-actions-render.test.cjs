// #356: Copy and Regenerate on an assistant reply. Loads ChatView.tsx's exported MessageActions
// through Vite's SSR pipeline (same technique as customise-i18n-render.test.cjs) so JSX and its
// import graph resolve exactly as in the app, and renders it to static markup — both are plain
// buttons with no post-mount effects, so a static render is a faithful check of what ships.
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

test('Copy is always present and labelled; Regenerate only renders when canRegenerate is true', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MessageActions } = await server.ssrLoadModule('/src/components/ChatView.tsx');

    const withoutRegenerate = renderToStaticMarkup(React.createElement(MessageActions, {
      content: '**bold** reply', canRegenerate: false, onRegenerate: () => {}, regenerateDisabled: false,
    }));
    assert.match(withoutRegenerate, /aria-label="Copy"/);
    assert.doesNotMatch(withoutRegenerate, /aria-label="Regenerate"/);

    const withRegenerate = renderToStaticMarkup(React.createElement(MessageActions, {
      content: 'reply', canRegenerate: true, onRegenerate: () => {}, regenerateDisabled: false,
    }));
    assert.match(withRegenerate, /aria-label="Regenerate"/);
    // Both are real <button> elements, not divs with a click handler — keyboard (Tab, Enter/Space)
    // reaches them with no extra wiring.
    const buttons = [...withRegenerate.matchAll(/<button\b[^>]*>/g)];
    assert.equal(buttons.length, 2, 'expected exactly Copy and Regenerate');
    for (const [tag] of buttons) assert.match(tag, /type="button"/);
  });
});

test('Regenerate is disabled while streaming (or the composer is otherwise busy)', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MessageActions } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(MessageActions, {
      content: 'reply', canRegenerate: true, onRegenerate: () => {}, regenerateDisabled: true,
    }));
    const regenerateTag = html.slice(html.lastIndexOf('<button', html.indexOf('aria-label="Regenerate"')), html.indexOf('aria-label="Regenerate"') + 40);
    assert.match(regenerateTag, /disabled=""/);
  });
});

test('German catalogue translates both actions', async () => {
  await withSsr(async (server) => {
    global.navigator = { language: 'de-DE', languages: ['de-DE'] };
    global.localStorage.getItem = (key) => (key === 'noevia:account-preferences' ? JSON.stringify({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'de-DE' }) : null);
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    const { DE_DE } = await server.ssrLoadModule('/src/i18n/de-DE.ts');
    core.registerCatalogue('de-DE', DE_DE);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MessageActions } = await server.ssrLoadModule('/src/components/ChatView.tsx');
    const html = renderToStaticMarkup(React.createElement(MessageActions, {
      content: 'Antwort', canRegenerate: true, onRegenerate: () => {}, regenerateDisabled: false,
    }));
    assert.match(html, /aria-label="Kopieren"/);
    assert.match(html, /aria-label="Erneut generieren"/);
    assert.ok(html.includes('>Kopieren<'), 'visible label is also translated');
  });
});

// Source-level checks for behaviour that needs a full app to exercise (clipboard, streaming
// state, chat-wide history): Copy takes the raw Markdown, never the rendered HTML or the
// thinking block, and the actions row is only offered for a finished, non-errored reply.
test('Copy reads the reply\'s own Markdown `content`, and the row is withheld for an in-flight or errored reply', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');
  // `body` is the message's own `content`, or the Stopped placeholder worded in the active language (#634).
  assert.match(src, /const body = messageBodyText\(t, m\);/);
  assert.match(src, /content=\{body\}/);
  // #667: a last reply that ended on a note with no text (paused, declined, saved changes) keeps the row, for Regenerate.
  assert.match(src, /\{\(body \|\| \(m\.paused && isLast && !m\.coworkTask\)\) && !m\.error && !\(streaming && isLast\) && \(/);
  assert.match(src, /canRegenerate=\{isLast && !m\.coworkTask\}/);
});
