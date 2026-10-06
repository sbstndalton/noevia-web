// #600: the Code panel's harness line ("context 33% of 24,576", tokens, commands) is written in
// the interface language. qa/code-mode.cjs keeps asserting the English line; this renders the real
// TaskMeta through Vite's SSR pipeline (as hardware-tab-model-state.test.cjs does) in English and
// German, so the localised line is covered without a browser. Each language gets a fresh module
// graph, because the interface locale is resolved once from the browser's languages.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const META = { harness: 'opencode', harnessVersion: '1.18.31', usage: { total: 46000 }, context: { used: 8012, size: 24576, percent: 33 }, commands: 2, failedCommands: 1, limitations: [] };

async function render(language, metas) {
  const { createServer } = await import('vite');
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
  global.navigator = { language, languages: [language] };
  try {
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    core.registerCatalogue('de-DE', (await server.ssrLoadModule('/src/i18n/de-DE.ts')).DE_DE);
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { TaskMeta } = await server.ssrLoadModule('/src/components/code/CodePanel.tsx');
    return metas.map((meta) => renderToStaticMarkup(React.createElement(TaskMeta, { meta })).replace(/<[^>]+>/g, '').replace(/[  ]/g, ' '));
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('TaskMeta reads in English as before', async () => {
  const [full, one] = await render('en-GB', [META, { ...META, usage: null, commands: 1, failedCommands: 0 }]);
  assert.equal(full, 'opencode 1.18.31 · 46,000 tokens · context 33% of 24,576 · 2 commands, 1 failed');
  assert.equal(one, 'opencode 1.18.31 · context 33% of 24,576 · 1 command');
});

test('TaskMeta reads in German', async () => {
  const [de] = await render('de-DE', [META]);
  // The words follow the interface language. The digits follow appLocale(), which for the
  // "system" preference is the runtime's own default (Node's here, the browser's in the app), so
  // only the separators are left loose; the German-browser digits are covered by qa/locale-600-603.cjs.
  assert.match(de, /^opencode 1\.18\.31 · 46[.,]000 Tokens · Kontext 33 ?% von 24[.,]576 · 2 Befehle, 1 fehlgeschlagen$/);
  assert.doesNotMatch(de, /context|commands|failed/);
});
