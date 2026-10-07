// #340 — General → Capabilities' "Project retrieval" row goes through the same tri-state as
// Settings → Service status, via exported pure helpers (CapabilitiesCard itself fetches health
// through an effect, which react-dom/server's static renderer never runs, so the helpers are
// the testable seam — see customise-i18n-render.test.cjs's note on the same limitation).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function loadHelpers() {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'] };
  await server.ssrLoadModule('/src/i18n/settings/index.ts');
  const mod = await server.ssrLoadModule('/src/components/GeneralSettings.tsx');
  const { core } = { core: await server.ssrLoadModule('/src/i18n/core.ts') };
  const t = (key, params) => core.translate('en-GB', key, params);
  t.plural = (key, count, params) => core.translatePlural('en-GB', key, count, params);
  t.locale = 'en-GB';
  return { mod, t, cleanup: async () => { delete global.window; delete global.document; delete global.localStorage; delete global.navigator; await server.close(); } };
}

test('retrievalState prefers the tri-state field, falling back to the boolean only when absent', async () => {
  const { mod, cleanup } = await loadHelpers();
  try {
    assert.equal(mod.retrievalState(null), null);
    assert.equal(mod.retrievalState({ retrieval: 'degraded', ragAvailable: true }), 'degraded');
    assert.equal(mod.retrievalState({ ragAvailable: true }), 'available');
    assert.equal(mod.retrievalState({ ragAvailable: false }), 'unavailable');
    assert.equal(mod.retrievalState({ ragAvailable: null }), null, 'still checking');
  } finally { await cleanup(); }
});

test('#340 the capabilities badge shows "Degraded" with a one-line explanation, distinct from Available', async () => {
  const { mod, t, cleanup } = await loadHelpers();
  try {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const badge = (on, onText, offText) => React.createElement('span', { className: `set-badge${on ? ' is-on' : ''}` }, on === null ? 'checking' : on ? onText : offText);

    const degradedHtml = renderToStaticMarkup(mod.retrievalBadge({ retrieval: 'degraded', ragAvailable: true }, t, badge));
    assert.match(degradedHtml, /Degraded/);
    assert.doesNotMatch(degradedHtml, />Available</);
    assert.equal(mod.retrievalDescription({ retrieval: 'degraded', ragAvailable: true }, t),
      'The embedding service cannot be reached right now. Small files and source excerpts still reach the model; semantic search does not.');

    const availableHtml = renderToStaticMarkup(mod.retrievalBadge({ retrieval: 'available', ragAvailable: true }, t, badge));
    assert.match(availableHtml, />Available</);
    assert.equal(mod.retrievalDescription({ retrieval: 'available', ragAvailable: true }, t),
      'Searches a project’s files for the parts relevant to your message.');

    const unavailableHtml = renderToStaticMarkup(mod.retrievalBadge({ retrieval: 'unavailable', ragAvailable: false }, t, badge));
    assert.match(unavailableHtml, /No index on this deployment/);
  } finally { await cleanup(); }
});
