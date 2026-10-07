// #293 review: a render-level regression guard, not just a catalogue-completeness check. Loads the
// real StatsBar module through Vite's SSR pipeline (so JSX, CSS imports and its full import graph
// resolve exactly as they do in the app) and renders it to static markup with the German catalogue
// registered, asserting the translated labels are actually on the page.
//
// ReasoningControl's composer pill only renders once its /api/reasoning-settings fetch resolves,
// inside a useEffect — and react-dom/server's static renderer never runs effects, with or without a
// DOM, so there is no way to reach that render pass without a full browser (that coverage already
// exists in qa/customise-footer-i18n.cjs, which drives a real page with Playwright). What a plain
// Node test *can* check without a browser is that the exact keys ReasoningControl.tsx's composer
// pill calls resolve to the German text this PR added, catching a renamed or deleted key the
// generic completeness test in i18n.test.cjs would not (it does not know which keys a given
// component actually uses).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('StatsBar renders the chat-shell footer in German once the base catalogue is registered', async () => {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  try {
    // Minimal browser globals StatsBar's initial (effect-free) render touches: phone-width
    // detection and the disclosure's remembered open state. No DOM, no network.
    global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
    global.document = { documentElement: { dataset: {} } };
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    global.navigator = { language: 'de-DE', languages: ['de-DE'] };
    try {
      const core = await server.ssrLoadModule('/src/i18n/core.ts');
      const { DE_DE } = await server.ssrLoadModule('/src/i18n/de-DE.ts');
      core.registerCatalogue('de-DE', DE_DE);
      // The interface locale comes from the account preference, cached in localStorage; StatsBar
      // itself never reads locale directly.
      global.localStorage.getItem = (key) => (key === 'noevia:account-preferences' ? JSON.stringify({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'de-DE' }) : null);

      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { StatsBar } = await server.ssrLoadModule('/src/components/StatsBar.tsx');
      const html = renderToStaticMarkup(React.createElement(StatsBar, { stats: null }));
      for (const german of ['Geschwindigkeit', 'Erstes Token', 'Letzte Antwort', 'Engine gesamt', 'GPU']) {
        assert.ok(html.includes(german), `StatsBar (de-DE) is missing "${german}": ${html.slice(0, 400)}`);
      }
      assert.ok(!html.includes('Speed') && !html.includes('First token'), 'StatsBar (de-DE) still shows the English labels');
    } finally {
      delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    }
  } finally {
    await server.close();
  }
});

test("ReasoningControl's composer Thinking pill keys resolve to this PR's German text", async () => {
  const ts = require('typescript');
  const vm = require('node:vm');
  const dir = path.join(__dirname, '../../src/i18n');
  const cache = {};
  function load(name) {
    name = path.posix.normalize(name);
    if (cache[name]) return cache[name];
    const exports = {}; cache[name] = exports;
    const code = ts.transpileModule(fs.readFileSync(path.join(dir, name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const here = path.posix.dirname(name);
    vm.runInNewContext(code, { exports, Intl, console, Promise, require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
    return exports;
  }
  const core = load('core');
  core.registerCatalogue('de-DE', load('de-DE').DE_DE);

  const src = fs.readFileSync(path.join(__dirname, '../../src/components/ReasoningControl.tsx'), 'utf8');
  const keys = [...src.matchAll(/t\('(composer\.thinking\.[a-zA-Z]+)'\)/g)].map((m) => m[1]);
  assert.ok(keys.includes('composer.thinking.label'), 'the pill label key moved or was renamed');
  assert.ok(keys.includes('composer.thinking.standard') && keys.includes('composer.thinking.low') && keys.includes('composer.thinking.high'), 'a level name key moved or was renamed');
  const expected = { 'composer.thinking.label': 'Denken', 'composer.thinking.ariaLabel': 'Denkaufwand', 'composer.thinking.auto': 'Auto', 'composer.thinking.low': 'Niedrig', 'composer.thinking.standard': 'Standard', 'composer.thinking.high': 'Hoch' };
  for (const [key, german] of Object.entries(expected)) {
    assert.ok(keys.includes(key), `ReasoningControl.tsx no longer calls t('${key}')`);
    assert.equal(core.translate('de-DE', key), german, `${key} does not render "${german}" in German`);
  }
});
