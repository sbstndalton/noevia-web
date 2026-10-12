'use strict';
// Shared loader for the real interface catalogues (#1489 and later sweep fixes): every segment of a
// locale (base, settings, diary, projects, customise, models) merged into one dictionary, read from
// source the same way locale-640-645.test.cjs does. Not a test file (no *.test.cjs suffix).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const I18N = path.join(__dirname, '../../src/i18n');
const SEGMENT_DIRS = ['', 'settings/', 'diary/', 'projects/', 'customise/', 'models/'];
const LOCALES = ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE'];

function loadModule(file) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports_ = {};
  vm.runInNewContext(code, { exports: exports_, require: () => ({}) });
  return exports_;
}

/** Every string key of one locale, all segments merged. Missing segment files are skipped. */
function catalogue(locale) {
  const merged = {};
  for (const dir of SEGMENT_DIRS) {
    const file = path.join(I18N, dir, `${locale}.ts`);
    if (!fs.existsSync(file)) continue;
    for (const value of Object.values(loadModule(file))) {
      if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (typeof v === 'string') merged[k] = v;
    }
  }
  return merged;
}

const English = () => catalogue('en-GB');

module.exports = { catalogue, English, LOCALES, I18N };
