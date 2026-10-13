'use strict';
// #1491 (and the same English labels in #1492-#1497): a passkey stored as "Passkey 1" and the built-in
// engine's "Local inference" label are shown in the viewer's language; a user's own names are not
// touched. Also the es-ES toolbox count no longer reads as a literal "cajas de herramientas".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

function loadModule(file) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports_ = {};
  vm.runInNewContext(code, { exports: exports_, require: () => ({}) });
  return exports_;
}
const { passkeyDisplayName, providerDisplayName } = loadModule(path.join(__dirname, '../../src/display-names.ts'));

// The same lookup the app does, against the real catalogue, with {placeholders} filled in.
const tFor = (locale) => {
  const cat = catalogue(locale);
  const en = catalogue('en-GB');
  return (key, params = {}) => (cat[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
};

test('#1491 a passkey stored as "Passkey N" is shown with the number in the viewer\'s language', () => {
  assert.equal(passkeyDisplayName('Passkey 1', tFor('es-ES')), 'Llave de acceso 1');
  assert.equal(passkeyDisplayName('Passkey 3', tFor('fr-FR')), 'Clé d’accès 3');
  assert.equal(passkeyDisplayName('Passkey 1', tFor('en-GB')), 'Passkey 1');
});

test('#1491 a name the user chose is shown exactly as typed', () => {
  assert.equal(passkeyDisplayName('Laptop', tFor('es-ES')), 'Laptop');
  assert.equal(passkeyDisplayName('Passkey 12345', tFor('es-ES')), 'Passkey 12345', 'not the shape the app writes');
  assert.equal(passkeyDisplayName('My Passkey 1', tFor('es-ES')), 'My Passkey 1');
});

test('#1491 the built-in engine\'s default provider label is translated; an operator\'s own label is kept', () => {
  assert.equal(providerDisplayName({ label: 'Local inference' }, tFor('es-ES')), 'Inferencia local');
  assert.equal(providerDisplayName({ label: 'Local inference' }, tFor('sv-SE')), 'Lokal inferens');
  assert.equal(providerDisplayName({ label: 'Garage GPU' }, tFor('es-ES')), 'Garage GPU');
});

test('#1491 every locale has the local inference label, translated and free of placeholders', () => {
  const english = catalogue('en-GB')['displayName.localInference'];
  assert.equal(english, 'Local inference');
  for (const locale of LOCALES) {
    const value = catalogue(locale)['displayName.localInference'];
    assert.ok(value && value.trim(), `${locale} has displayName.localInference`);
    assert.doesNotMatch(value, /\{\w+\}/, `${locale} has no placeholder`);
    if (locale !== 'en-GB') assert.notEqual(value, english, `${locale} is translated`);
  }
});

test('#1491 the Settings page and the model popup both use the display helpers', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsView.tsx'), 'utf8');
  const popup = fs.readFileSync(path.join(__dirname, '../../src/components/ModelPopup.tsx'), 'utf8');
  assert.match(settings, /\{passkeyDisplayName\(k\.name, t\)\}/);
  assert.doesNotMatch(settings, /\{k\.name\}<\/span>/);
  assert.match(settings, /\{providerDisplayName\(p, t\)\}/);
  assert.match(popup, /<option key=\{p\.id\} value=\{p\.id\}>\{providerDisplayName\(p, t\)\}<\/option>/);
});

test('#1491 es-ES counts toolboxes as sets of tools, not "cajas de herramientas"', () => {
  const es = catalogue('es-ES');
  assert.equal(es['capabilities.toolboxes.one'], '{count} conjunto de herramientas');
  assert.equal(es['capabilities.toolboxes.other'], '{count} conjuntos de herramientas');
  assert.doesNotMatch(es['capabilities.toolboxes.other'], /cajas/);
});
