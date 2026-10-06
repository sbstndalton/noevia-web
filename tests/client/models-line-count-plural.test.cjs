'use strict';
// Line counts in the Models area (auto-tune "What it did", engine log "last N lines") take singular and plural forms.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, console, Promise,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}
const core = load('i18n/core');
const FILES = { 'en-GB': 'EN_GB', 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(FILES)) {
  const m = load(`i18n/models/${locale}`);
  core.registerSegment('models', locale, m[Object.keys(m).find((k) => k.startsWith(name))]);
}
const p = (locale, key, n) => core.translatePlural(locale, key, n);

test('auto-tune "What it did" uses singular for one line (en, de)', () => {
  assert.equal(p('en-GB', 'mm.autotune.whatItDid', 1), 'What it did (1 line)');
  assert.equal(p('en-GB', 'mm.autotune.whatItDid', 2), 'What it did (2 lines)');
  assert.equal(p('de-DE', 'mm.autotune.whatItDid', 1), 'Was es getan hat (1 Zeile)');
  assert.equal(p('de-DE', 'mm.autotune.whatItDid', 2), 'Was es getan hat (2 Zeilen)');
});

test('engine log count uses singular for one line', () => {
  assert.equal(p('en-GB', 'mm.logs.last', 1), 'last 1 line');
  assert.equal(p('en-GB', 'mm.logs.last', 200), 'last 200 lines');
  assert.equal(p('fr-FR', 'mm.logs.last', 1), '1 dernière ligne');
});

test('every locale has both forms, and the components use the plural helper', () => {
  for (const locale of Object.keys(FILES)) for (const key of ['mm.autotune.whatItDid', 'mm.logs.last']) for (const f of ['one', 'other']) {
    const v = core.translate(locale, `${key}.${f}`); assert.ok(v && v !== `${key}.${f}` && v.includes('{count}'), `${locale} ${key}.${f}`);
  }
  const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');
  assert.match(read('components/models/AutoTune.tsx'), /t\.plural\('mm\.autotune\.whatItDid'/);
  assert.match(read('components/models/HardwareTab.tsx'), /t\.plural\('mm\.logs\.last'/);
});
