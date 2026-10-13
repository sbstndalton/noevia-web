// #1555: Customise's third tab was labelled "Plugins" but holds the MCP servers, so the tab, the
// page title and the sidebar disagreed. The tab now says what it holds ("MCP servers", the same
// noun the Connectors page and the Settings directory already use), and every sentence that gives
// a path through Customise names the real tabs. Loaded the same way the other catalogue tests load
// real source: transpiled and run in a fresh VM context, so the production strings are checked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(relPath, resolveDir) {
  const full = path.posix.normalize(path.posix.join(resolveDir, relPath));
  if (cache[full]) return cache[full];
  const exports = {};
  cache[full] = exports;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, full + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const here = path.posix.dirname(full);
  vm.runInNewContext(code, {
    exports, Intl, console: { warn() {} }, Promise,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(m, here); },
  });
  return exports;
}

const core = load('i18n/core', '.');
const LOCALES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(LOCALES)) {
  core.registerCatalogue(locale, load(`i18n/${locale}`, '.')[name]);
  core.registerSegment('settings', locale, load(`i18n/settings/${locale}`, '.')[`${name}_SETTINGS`]);
  core.registerSegment('customise', locale, load(`i18n/customise/${locale}`, '.')[`${name}_CUSTOMISE`]);
}
core.registerSegment('settings', 'en-GB', load('i18n/settings/en-GB', '.').EN_GB_SETTINGS);
core.registerSegment('customise', 'en-GB', load('i18n/customise/en-GB', '.').EN_GB_CUSTOMISE);

const pluginsSrc = fs.readFileSync(path.join(SRC, 'components/plugins/PluginsView.tsx'), 'utf8');

test('the third Customise tab is named for what it holds: MCP servers, in English', () => {
  assert.equal(core.translate('en-GB', 'customise.tab.plugins'), 'MCP servers');
});

test('the tab name is the same noun the Connectors page and Settings use, in every locale', () => {
  for (const locale of Object.keys(LOCALES)) {
    const tab = core.translate(locale, 'customise.tab.plugins');
    assert.equal(tab, core.translate(locale, 'connectors.mcp.title'), `${locale}: tab and connectors.mcp.title differ`);
    assert.notEqual(tab, core.translate(locale, 'customise.tab.skills'), `${locale}: tab name collides with Skills`);
    assert.notEqual(tab, core.translate(locale, 'connectors.title'), `${locale}: tab name collides with Connectors`);
  }
});

test('no sentence that gives a path through Customise still says Plugins: the path names the sidebar item and the real tab', () => {
  assert.doesNotMatch(pluginsSrc, /plugins: t\('customise\.tab\.plugins'\)/, 'a path sentence still uses the tab name as "Plugins"');
  assert.match(pluginsSrc, /section: t\('sidebar\.customise'\), tab: t\('connectors\.title'\)/, 'the OAuth sign-in path does not name Customise → Connectors');
  assert.match(pluginsSrc, /customise\.eachPersonOwnKeyHint', \{ section: t\('sidebar\.customise'\), tab: t\('customise\.tab\.plugins'\)/, 'the key hint does not name Customise → MCP servers');
  for (const locale of ['en-GB', ...Object.keys(LOCALES)]) {
    const sign = core.translate(locale, 'customise.oauthCompleteNote', { tools: '1 tool', section: 'S', tab: 'T' });
    assert.match(sign, /\bS\b/, `${locale}: oauthCompleteNote lost its {section} placeholder`);
    assert.match(sign, /\bT\b/, `${locale}: oauthCompleteNote lost its {tab} placeholder`);
    assert.doesNotMatch(sign, /\{(plugins|connected)\}/, `${locale}: oauthCompleteNote still has the old placeholders`);
    const hint = core.translate(locale, 'customise.eachPersonOwnKeyHint', { section: 'S', tab: 'T' });
    assert.match(hint, /\bS\b.*\bT\b/, `${locale}: eachPersonOwnKeyHint does not render section then tab`);
  }
  const summary = core.translate('en-GB', 'connectors.mcp.summary', { section: 'Customise', mcp: 'MCP servers' });
  assert.match(summary, /in Customise → MCP servers\./);
  assert.doesNotMatch(summary, /Plugins/);
});
