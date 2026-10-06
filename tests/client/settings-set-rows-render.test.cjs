// #414: Service status's "Connected services" list, the Diary & storage page's Diary toggle, and
// Models summary move from the borderless .card-list onto .set-rows, the grouped surface
// Appearance/Data/Notifications already use. Render-level regression guard for the container class
// itself (Users' own list is effect-gated behind a fetch and covered instead by
// qa/header-container-parity.cjs, which drives a real page), loaded through Vite's SSR pipeline so
// JSX and the real i18n catalogue resolve exactly as in the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withModule(name, fn) {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'] };
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

const HEALTH = { inferenceUp: true, diaryUp: true, ragAvailable: null, retrieval: null };
const noop = () => {};

test('Service status\'s "Connected services" list is .set-rows, not .card-list', () => withModule('/src/components/SettingsView.tsx', ({ SettingsView }, React, render) => {
  const html = render(React.createElement(SettingsView, {
    section: 'status', models: [], modelsError: null, routes: [], projects: [], health: HEALTH, stats: null,
    onOpenModels: noop, onOpenModelManager: noop, diaryEnabled: true, onDiaryEnabledChange: noop,
  }));
  assert.match(html, /<div class="set-rows">/);
  assert.doesNotMatch(html, /class="card-list"/);
  assert.match(html, /Inference/);
}));

test('the Diary & storage page\'s own Diary toggle is .set-rows, not .card-list', () => withModule('/src/components/SettingsView.tsx', ({ SettingsView }, React, render) => {
  const html = render(React.createElement(SettingsView, {
    section: 'diary', models: [], modelsError: null, routes: [], projects: [], health: HEALTH, stats: null,
    onOpenModels: noop, onOpenModelManager: noop, diaryEnabled: true, onDiaryEnabledChange: noop,
  }));
  // #414 left the shared StoragePicker/DiaryConnectors components (also rendered on this page)
  // on .card-list — they are used in other, unrelated surfaces too (onboarding, Diary's own tab)
  // — see docs/design-notes/page-headers.md. Only the Diary toggle itself, owned by this page, is
  // asserted here.
  const optionalApps = html.match(/Optional apps<\/div>(.*?)<\/div><p class="route-note"/s)[1];
  assert.match(optionalApps, /<div class="set-rows">/);
  assert.doesNotMatch(optionalApps, /class="card-list"/);
}));

test('Models summary\'s engine/installed/routing list is .set-rows, not .card-list', () => withModule('/src/components/models/ModelsSummary.tsx', ({ ModelsSummary }, React, render) => {
  const html = render(React.createElement(ModelsSummary, { models: [], modelsError: null, health: HEALTH, stats: null, onOpen: noop }));
  assert.match(html, /<div class="set-rows">/);
  assert.doesNotMatch(html, /class="card-list"/);
}));
