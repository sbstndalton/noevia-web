// #366: Settings → Service status used to tag only the internal MCP server "built-in" and leave
// every other row (nextcloud, tavily, an admin-added directory server…) unlabelled, which gave no
// way to tell, from this list, which servers Plugins → Added would also show. Every row is now
// tagged one or the other. McpStatus.tsx fetches its own status through an effect
// (fetchToolboxes), and react-dom/server's static renderer never runs effects
// (customise-i18n-render.test.cjs), so this checks the real source and the real translations
// rather than a render that would only ever reach the pre-fetch "Checking…" state.
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
core.registerSegment('settings', 'en-GB', load('i18n/settings/en-GB', '.').EN_GB_SETTINGS);
for (const [locale, name] of Object.entries(LOCALES)) core.registerSegment('settings', locale, load(`i18n/settings/${locale}`, '.')[`${name}_SETTINGS`]);

test('McpStatus.tsx tags every server built-in or added — no row is left unlabelled', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/McpStatus.tsx'), 'utf8');
  assert.match(src, /server\.directory\s*\?\s*t\('serviceStatus\.mcp\.added'\)\s*:\s*t\('serviceStatus\.mcp\.builtIn'\)/, 'every row must resolve to one label or the other, not just internal-auth servers');
  assert.doesNotMatch(src, /server\.auth\s*===\s*'internal'\s*&&/, 'the old internal-only condition should be gone: nextcloud/tavily rows were left unlabelled by it');
});

test('serviceStatus.mcp.added and .builtIn are distinct, real text in every locale', () => {
  for (const locale of ['en-GB', ...Object.keys(LOCALES)]) {
    const added = core.translate(locale, 'serviceStatus.mcp.added');
    const builtIn = core.translate(locale, 'serviceStatus.mcp.builtIn');
    assert.ok(added && added !== 'serviceStatus.mcp.added', `${locale}: serviceStatus.mcp.added missing`);
    assert.notEqual(added, builtIn, `${locale}: "added" and "built-in" must read differently`);
  }
});
