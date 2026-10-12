'use strict';
// #1501: the collapsible row above a reply said "Legacy routing · Smart · fallback", and the Laya
// decision service was named "Laya" in the same row. The row now says what answered in plain words:
// "Auto · Smart · fallback model" for the built-in router, "Decision service · Smart" for the decision
// service. Rendered through Vite's SSR pipeline so JSX and the real English catalogue resolve as in the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { catalogue } = require('./i18n-catalogue.cjs');

async function withModule(name, fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // Node 21+ exposes navigator as a getter, so define it instead of assigning.
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    const mod = await server.ssrLoadModule(name);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    return await fn(mod, React, renderToStaticMarkup);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

const base = { offered: [], effectiveRole: 'smart', selectedRole: null, latencyMs: 120, scores: {} };
const summaryOf = (html) => html.match(/<summary>(.*?)<\/summary>/)[1];

test('#1501 the built-in router\'s reply is labelled Auto, never Legacy', () => withModule('/src/components/ChatView.tsx', ({ RoutingDetails }, React, render) => {
  const plain = summaryOf(render(React.createElement(RoutingDetails, { decision: { ...base, status: 'accepted', model: 'qwen', backend: 'legacy' } })));
  assert.equal(plain, 'Auto · Smart');
  const fallback = summaryOf(render(React.createElement(RoutingDetails, { decision: { ...base, status: 'fallback', model: 'qwen', fallbackReason: 'deadline' } })));
  assert.equal(fallback, 'Auto · Smart · fallback model');
  assert.doesNotMatch(plain + fallback, /legacy|routing/i);
}));

test('#1501 the decision service is named "Decision service", never by its internal product name', () => withModule('/src/components/ChatView.tsx', ({ RoutingDetails }, React, render) => {
  const byModel = summaryOf(render(React.createElement(RoutingDetails, { decision: { ...base, status: 'accepted', model: 'convaiinnovations/laya', backend: 'decision-service' } })));
  assert.equal(byModel, 'Decision service · Smart');
  const byBackend = summaryOf(render(React.createElement(RoutingDetails, { decision: { ...base, status: 'accepted', model: 'x', backend: 'decision-service' } })));
  assert.equal(byBackend, 'Decision service · Smart');
  assert.doesNotMatch(byModel, /Laya/);
}));

test('#1501 the local decision model keeps its own name', () => withModule('/src/components/ChatView.tsx', ({ RoutingDetails }, React, render) => {
  const local = summaryOf(render(React.createElement(RoutingDetails, { decision: { ...base, status: 'accepted', model: 'x', backend: 'llama-logit' } })));
  assert.equal(local, 'Local logit · Smart');
}));

test('#1501 the row templates no longer use the word routing or legacy in any English string', () => {
  const en = catalogue('en-GB');
  assert.equal(en['chat.route.srcLegacy'], 'Auto');
  assert.equal(en['chat.route.summary'], '{source} · {role}');
  assert.equal(en['chat.route.summaryFallback'], '{source} · {role} · fallback model');
  assert.doesNotMatch(en['chat.route.srcLegacy'] + en['chat.route.summary'] + en['chat.route.summaryFallback'], /legacy|routing/i);
});
