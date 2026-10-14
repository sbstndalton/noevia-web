'use strict';
// Shared loader for the batch-4 copy tests: reads the real catalogue modules from source (TypeScript
// transpiled, no build, no browser) so the assertions are about the strings a person sees in each
// locale. Only the catalogue files are loaded; each test file says which keys it checks.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {};
  cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, `${file}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, {
    exports: exports_, Intl, Object, Array, Error, Promise, setTimeout, clearTimeout, AbortController,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error(`unexpected import ${m}`); return load(path.posix.join(here, m)); },
  });
  return exports_;
}

/** The Settings segment for every locale the repo ships, keyed by locale id. */
const SETTINGS_LOCALES = {
  'en-GB': ['settings/en-GB', 'EN_GB_SETTINGS'],
  'de-DE': ['settings/de-DE', 'DE_DE_SETTINGS'],
  'es-ES': ['settings/es-ES', 'ES_ES_SETTINGS'],
  'fr-FR': ['settings/fr-FR', 'FR_FR_SETTINGS'],
  'it-IT': ['settings/it-IT', 'IT_IT_SETTINGS'],
  'nb-NO': ['settings/nb-NO', 'NB_NO_SETTINGS'],
  'nl-NL': ['settings/nl-NL', 'NL_NL_SETTINGS'],
  'pt-BR': ['settings/pt-BR', 'PT_BR_SETTINGS'],
  'sv-SE': ['settings/sv-SE', 'SV_SE_SETTINGS'],
};
const MODELS_LOCALES = {
  'en-GB': ['models/en-GB', 'EN_GB_MODELS'],
  'de-DE': ['models/de-DE', 'DE_DE_MODELS'],
  'es-ES': ['models/es-ES', 'ES_ES_MODELS'],
  'fr-FR': ['models/fr-FR', 'FR_FR_MODELS'],
  'it-IT': ['models/it-IT', 'IT_IT_MODELS'],
  'nb-NO': ['models/nb-NO', 'NB_NO_MODELS'],
  'nl-NL': ['models/nl-NL', 'NL_NL_MODELS'],
  'pt-BR': ['models/pt-BR', 'PT_BR_MODELS'],
  'sv-SE': ['models/sv-SE', 'SV_SE_MODELS'],
};

function catalogues(table) {
  const out = {};
  for (const [locale, [file, name]] of Object.entries(table)) {
    const mod = load(`i18n/${file}`);
    if (!mod[name]) throw Error(`${file} does not export ${name}`);
    out[locale] = mod[name];
  }
  return out;
}

module.exports = { SETTINGS_LOCALES, MODELS_LOCALES, catalogues, load };
