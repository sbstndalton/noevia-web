// #366: the sidebar's "N servers" count and Plugins → Added's count answer different questions
// (every configured server vs only ones an admin added through the directory) and used to look
// contradictory. mcpFooterSummary is the pulled-out, render-free logic Sidebar.tsx now calls;
// loaded the same way i18n.test.cjs loads real source (transpiled, run in a fresh VM context) so
// this exercises the actual production strings, not a copy of them.
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
const EN = load('i18n/en-GB', '.').EN_GB;
const LOCALES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(LOCALES)) core.registerCatalogue(locale, load(`i18n/${locale}`, '.')[name]);
const { mcpFooterSummary } = load('mcp-summary', '.');

// A minimal stand-in for useT()'s Translate function: real interpolation, real catalogue text.
const t = (locale) => Object.assign((key, params) => core.translate(locale, key, params), { locale, plural: (key, count, params) => core.translatePlural(locale, key, count, params) });

const server = (id, extra = {}) => ({ id, auth: 'none', error: null, discovered: 1, ...extra });

test('the reported bug: 3 configured servers, none added — every locale explains the mismatch instead of just counting', () => {
  const mcp = { configured: true, discovered: 175, servers: [server('nextcloud'), server('tavily'), server('internal-mcp', { auth: 'internal' })] };
  for (const locale of ['en-GB', ...Object.keys(LOCALES)]) {
    const summary = mcpFooterSummary(mcp, t(locale));
    assert.match(summary.label, /175/, `${locale}: tool count lost`);
    assert.match(summary.label, /3/, `${locale}: server count lost`);
    assert.ok(summary.label.endsWith(core.translate(locale, 'sidebar.mcpServersBuiltIn', { count: 3 })), `${locale}: label does not end with the built-in qualifier: ${summary.label}`);
    assert.equal(summary.title, core.translate(locale, 'sidebar.mcpBuiltInTooltip'), `${locale}: tooltip does not explain built-in vs added`);
    assert.equal(summary.degraded, false);
  }
});

test('English wording matches the issue’s own example', () => {
  const mcp = { configured: true, discovered: 175, servers: [server('a'), server('b'), server('c')] };
  const summary = mcpFooterSummary(mcp, t('en-GB'));
  assert.equal(summary.label, 'MCP · 175 tools · 3 servers (built-in)');
  assert.match(summary.title, /Plugins → Added/);
});

test('a server added through the MCP directory is not called built-in, and a full match needs no qualifier', () => {
  const mixed = mcpFooterSummary({ configured: true, discovered: 10, servers: [server('a'), server('b'), server('added', { directory: true })] }, t('en-GB'));
  assert.equal(mixed.label, 'MCP · 10 tools · 3 servers (1 added)');
  assert.match(mixed.title, /Plugins → Added/);

  const allAdded = mcpFooterSummary({ configured: true, discovered: 10, servers: [server('a', { directory: true }), server('b', { directory: true })] }, t('en-GB'));
  assert.equal(allAdded.label, 'MCP · 10 tools · 2 servers');
  assert.equal(allAdded.title, undefined, 'Added already accounts for all of them; no explanation needed');
});

test('a single server never gets a count (unchanged from before #366), and errors still win over the built-in note', () => {
  const one = mcpFooterSummary({ configured: true, discovered: 4, servers: [server('solo')] }, t('en-GB'));
  assert.equal(one.label, 'MCP · 4 tools');
  assert.equal(one.title, undefined);

  const down = mcpFooterSummary({ configured: true, discovered: 4, servers: [server('a'), server('b', { error: 'timed out' })] }, t('en-GB'));
  assert.equal(down.label, 'MCP · 4 tools · b down');
  assert.equal(down.title, 'b: timed out', 'a per-server error still wins the tooltip over the built-in explanation');
  assert.equal(down.degraded, true);
});

test('every server down still reports unavailable, unaffected by the #366 refactor', () => {
  const summary = mcpFooterSummary({ configured: true, discovered: 0, servers: [server('a', { error: 'x' }), server('b', { error: 'y' })] }, t('en-GB'));
  assert.equal(summary.label, 'MCP · unavailable');
  assert.equal(summary.danger, true);
});

test('the base catalogue and every locale keep {count}/{added} in the new keys', () => {
  assert.match(EN['sidebar.mcpServersBuiltIn'], /\{count\}/);
  assert.match(EN['sidebar.mcpServersPartlyAdded'], /\{count\}/);
  assert.match(EN['sidebar.mcpServersPartlyAdded'], /\{added\}/);
  for (const [locale, name] of Object.entries(LOCALES)) {
    const table = load(`i18n/${locale}`, '.')[name];
    assert.match(table['sidebar.mcpServersBuiltIn'], /\{count\}/, locale);
    assert.match(table['sidebar.mcpServersPartlyAdded'], /\{count\}/, locale);
    assert.match(table['sidebar.mcpServersPartlyAdded'], /\{added\}/, locale);
  }
});

test('#627 the footer counts and words come from the catalogue, in each locale’s plural forms and number format', () => {
  const two = { configured: true, discovered: 1234, servers: [server('a', { directory: true }), server('b', { directory: true })] };
  assert.equal(mcpFooterSummary(two, t('de-DE')).label, 'MCP · 1.234 Werkzeuge · 2 Server');
  assert.equal(mcpFooterSummary(two, t('fr-FR')).label.replace(/[\u202f\u00a0]/g, ' '), 'MCP · 1 234 outils · 2 serveurs');
  assert.equal(mcpFooterSummary(two, t('en-GB')).label, 'MCP · 1,234 tools · 2 servers');
  const builtIn = { configured: true, discovered: 175, servers: [server('a'), server('b'), server('c')] };
  assert.equal(mcpFooterSummary(builtIn, t('de-DE')).label, 'MCP · 175 Werkzeuge · 3 Server (integriert)');
  assert.equal(mcpFooterSummary(builtIn, t('fr-FR')).label, 'MCP · 175 outils · 3 serveurs (intégrés)');
  // One tool is singular; zero is plural in English and German, singular in French.
  const one = { configured: true, discovered: 1, servers: [server('solo')] };
  assert.equal(mcpFooterSummary(one, t('en-GB')).label, 'MCP · 1 tool');
  assert.equal(mcpFooterSummary(one, t('de-DE')).label, 'MCP · 1 Werkzeug');
  assert.equal(mcpFooterSummary({ ...one, discovered: 0 }, t('en-GB')).label, 'MCP · 0 tools');
  assert.equal(mcpFooterSummary({ ...one, discovered: 0 }, t('fr-FR')).label, 'MCP · 0 outil');
  const down = { configured: true, discovered: 4, servers: [server('a'), server('b', { error: 'timed out' })] };
  assert.equal(mcpFooterSummary(down, t('de-DE')).label, 'MCP · 4 Werkzeuge · b ausgefallen');
  assert.equal(mcpFooterSummary(down, t('fr-FR')).label, 'MCP · 4 outils · b : indisponible');
  const dead = { configured: true, discovered: 0, servers: [server('a', { error: 'x' }), server('b', { error: 'y' })] };
  assert.equal(mcpFooterSummary(dead, t('de-DE')).label, 'MCP · nicht verfügbar');
  assert.equal(mcpFooterSummary(dead, t('fr-FR')).label, 'MCP · indisponible');
  for (const locale of ['en-GB', ...Object.keys(LOCALES)]) for (const key of ['sidebar.mcpTools.one', 'sidebar.mcpTools.other', 'sidebar.mcpServersAllAdded', 'sidebar.mcpUnavailable', 'sidebar.mcpDown'])
    assert.ok(core.translate(locale, key), `${locale} ${key}`);
});
