// #366: Plugins → Added's empty state ("No MCP servers added yet") used to read as a flat
// contradiction next to the sidebar's server count, with no way to reconcile the two. It now says
// built-in servers are always on and links to where they're listed (Service status). isAdmin and
// the added-servers list both arrive through effects (fetchProfile / apiFetch), and
// react-dom/server's static renderer never runs effects (customise-i18n-render.test.cjs), so a
// plain Node render always lands on the pre-effect state — this checks the actual wiring instead:
// the exact keys PluginsView.tsx's empty state calls, that they resolve to real text in every
// locale, and that the event it fires is the one App.tsx listens for.
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
for (const [locale, name] of Object.entries(LOCALES)) core.registerCatalogue(locale, load(`i18n/${locale}`, '.')[name]);
core.registerSegment('customise', 'en-GB', load('i18n/customise/en-GB', '.').EN_GB_CUSTOMISE);
for (const [locale, name] of Object.entries(LOCALES)) core.registerSegment('customise', locale, load(`i18n/customise/${locale}`, '.')[`${name}_CUSTOMISE`]);

const pluginsSrc = fs.readFileSync(path.join(SRC, 'components/plugins/PluginsView.tsx'), 'utf8');
const appSrc = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');

test('PluginsView\'s empty state calls the built-in-servers explanation and the Service status link, and fires the event App.tsx listens for', () => {
  assert.match(pluginsSrc, /t\('customise\.noAddedServers'\)/);
  assert.match(pluginsSrc, /t\('customise\.builtInServersNote'\)/, 'the empty state does not explain that built-in servers are always on');
  assert.match(pluginsSrc, /t\('customise\.viewServiceStatus'\)/, 'the empty state has no link to where built-in servers are listed');
  const eventMatch = pluginsSrc.match(/dispatchEvent\(new Event\('([^']+)'\)\)/);
  assert.ok(eventMatch, 'the empty state link does not dispatch a navigation event');
  const [, eventName] = eventMatch;
  assert.match(appSrc, new RegExp(`addEventListener\\('${eventName}'`), `App.tsx does not listen for ${eventName}`);
  assert.match(appSrc, /openSettings\('status'\)/, "the listener does not open Settings' Service status section");
});

test('the built-in-servers note and its link resolve to real, non-empty text in every locale', () => {
  for (const locale of ['en-GB', ...Object.keys(LOCALES)]) {
    const note = core.translate(locale, 'customise.builtInServersNote');
    const link = core.translate(locale, 'customise.viewServiceStatus');
    assert.ok(note.length > 10, `${locale}: customise.builtInServersNote is missing or trivial`);
    assert.ok(link.length > 3, `${locale}: customise.viewServiceStatus is missing or trivial`);
    assert.notEqual(note, 'customise.builtInServersNote', locale);
    assert.notEqual(link, 'customise.viewServiceStatus', locale);
  }
});

// #367: "…scripts a skill bundles are never downloaded or run" was ungrammatical; the fix reads
// "…scripts bundled with a skill are never downloaded or run."
test('#367 the Skills → Discover note reads grammatically in English, and no locale still carries the old construction', () => {
  const en = core.translate('en-GB', 'customise.skillsDirectoryNote');
  assert.match(en, /scripts bundled with a skill are never downloaded or run/);
  assert.doesNotMatch(en, /scripts a skill bundles/);
  for (const locale of Object.keys(LOCALES)) {
    const text = core.translate(locale, 'customise.skillsDirectoryNote');
    assert.ok(text && text !== 'customise.skillsDirectoryNote', `${locale}: skillsDirectoryNote missing`);
  }
});
