// #1556: Customise copy used internal jargon ("Enabled versions guide replies", "instruction
// skills", "this noevia", "this deployment", "Each MCP server is a toolbox a project chooses") and
// the sidebar footer opened with "MCP ·" and closed with "(built-in)". The English reads plainly, the
// footer no longer leads with the acronym, and every locale carries real text for the rewritten
// keys (not the English fallback).
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
  core.registerSegment('customise', locale, load(`i18n/customise/${locale}`, '.')[`${name}_CUSTOMISE`]);
}
core.registerSegment('customise', 'en-GB', load('i18n/customise/en-GB', '.').EN_GB_CUSTOMISE);
const { mcpFooterSummary } = load('mcp-summary', '.');

const REWRITTEN_CUSTOMISE = ['customise.skillsInstructionNote', 'customise.skillsNote', 'customise.mcpNote', 'customise.addedServersNote', 'customise.builtInServersNote'];
const REWRITTEN_BASE = ['sidebar.mcpServersBuiltIn', 'sidebar.mcpUnavailable', 'sidebar.mcpBuiltInTooltip'];
const JARGON = /this noevia|this deployment|enabled versions|instruction skills|toolbox|\(built-in\)|\bMCP ·|\bdeployment\b/i;

test('the rewritten Customise and footer sentences drop the internal jargon in English', () => {
  for (const key of [...REWRITTEN_CUSTOMISE, ...REWRITTEN_BASE]) {
    const text = core.translate('en-GB', key);
    assert.doesNotMatch(text, JARGON, `${key} still reads as internal jargon: ${text}`);
  }
});

test('every locale has its own text for each rewritten key, not the English fallback', () => {
  for (const key of [...REWRITTEN_CUSTOMISE, ...REWRITTEN_BASE]) {
    const english = core.translate('en-GB', key);
    for (const locale of Object.keys(LOCALES)) {
      const text = core.translate(locale, key, { count: 3, tools: 'x', section: 'S', tab: 'T' });
      assert.ok(text && text !== key, `${locale}: ${key} is missing`);
      assert.notEqual(text, english, `${locale}: ${key} is still English`);
    }
  }
});

test('the sidebar footer no longer opens with "MCP" and says built in, in plain words', () => {
  const t = (locale) => Object.assign((key, params) => core.translate(locale, key, params), { locale, plural: (key, count, params) => core.translatePlural(locale, key, count, params) });
  const server = (id, extra = {}) => ({ id, auth: 'none', error: null, discovered: 1, ...extra });
  const builtIn = mcpFooterSummary({ configured: true, discovered: 175, servers: [server('a'), server('b'), server('c')] }, t('en-GB'));
  assert.equal(builtIn.label, '175 tools · 3 servers, built in');
  const down = mcpFooterSummary({ configured: true, discovered: 4, servers: [server('a'), server('b', { error: 'x' })] }, t('en-GB'));
  assert.equal(down.label, '4 tools · b down');
  const dead = mcpFooterSummary({ configured: true, discovered: 0, servers: [server('a', { error: 'x' })] }, t('en-GB'));
  assert.equal(dead.label, 'Tools unavailable');
  for (const label of [builtIn.label, down.label, dead.label]) assert.doesNotMatch(label, /^MCP\b/);
});
