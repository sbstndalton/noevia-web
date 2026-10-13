'use strict';
// #1488: Settings > Users shows the raw English role keys ("admin", "member") in the translated
// locales. The row now words the role with the same catalogue keys the Account page uses
// (profile.admin / profile.member), so the two pages agree in every locale. The list is effect-gated
// behind a fetch, so this is a source-contract test plus a catalogue check, not a render.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function loadCatalogue(file) {
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports_ = {};
  vm.runInNewContext(code, { exports: exports_, require: () => ({}) });
  return exports_;
}

test('#1488 the Users row words the role through the profile catalogue, never the raw key', () => {
  const src = read('components/SettingsView.tsx');
  const row = src.match(/<span className="model-quant">@\{u\.username\}[^\n]*/);
  assert.ok(row, 'the Users row is present');
  assert.doesNotMatch(row[0], /\{u\.role\}/, 'the raw role key is not rendered');
  assert.match(row[0], /u\.role === 'admin' \? t\('profile\.admin'\) : t\('profile\.member'\)/);
});

test('#1488 every locale words both roles, never with the raw key, and the same way as the Account page', () => {
  // profile.* lives in the Settings segment (settings/<locale>.ts), registered with the base catalogue.
  const english = { ...loadCatalogue('i18n/en-GB.ts').EN_GB, ...loadCatalogue('i18n/settings/en-GB.ts').EN_GB_SETTINGS };
  const FILES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
  for (const [locale, name] of Object.entries(FILES)) {
    const cat = { ...loadCatalogue(`i18n/${locale}.ts`)[name], ...loadCatalogue(`i18n/settings/${locale}.ts`)[`${name}_SETTINGS`] };
    for (const key of ['profile.admin', 'profile.member']) {
      assert.ok(cat[key], `${locale} ${key}`);
      assert.doesNotMatch(cat[key], /^(admin|member)$/, `${locale} ${key} is not the raw role key`);
    }
    // "Member" is translated everywhere; "Administrator" is also the correct Norwegian word, so only
    // member is required to differ from English.
    assert.notEqual(cat['profile.member'], english['profile.member'], `${locale} profile.member is translated`);
  }
  assert.equal(loadCatalogue('i18n/settings/es-ES.ts').ES_ES_SETTINGS['profile.admin'], 'Administrador');
});
