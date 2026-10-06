'use strict';
// Theme families (#249): resolution, the migration from the retired materials, and agreement
// between src/theme-family.ts (the app) and public/theme.js (before paint).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = (file, extra = {}) => {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (m) => (m === './theme-family' ? family : require(m)), ...extra });
  return exports;
};
const family = load('theme-family.ts');

test('three families, Editorial by default', () => {
  assert.deepEqual([...family.FAMILIES], ['editorial', 'contemporary', 'glass']);
  assert.equal(family.DEFAULT_FAMILY, 'editorial');
  for (const name of family.FAMILIES) {
    const spec = family.FAMILY_SPECS[name];
    assert.ok(spec.label && spec.description && spec.display && spec.ui, `${name} is described`);
  }
});

for (const [saved, legacy, expected, why] of [
  ['glass', null, 'glass', 'a saved family'],
  [null, 'soft', 'editorial', 'Soft migrates to Editorial'],
  [null, 'material', 'contemporary', 'Material 3 migrates to Contemporary'],
  [null, 'liquid', 'glass', 'Liquid glass migrates to Glass'],
  ['contemporary', 'liquid', 'contemporary', 'a family wins over a leftover material'],
  [null, 'glass', 'editorial', 'a value that was never a material'],
  ['brutalist', null, 'editorial', 'an unknown family'],
  [null, '__proto__', 'editorial', 'a prototype key is not a migration'],
  [null, null, 'editorial', 'a new installation'],
]) test(`resolveFamily: ${why}`, () => assert.equal(family.resolveFamily(saved, legacy), expected));

test('storedFamily reads both keys and survives blocked storage', () => {
  const store = { 'noevia:material': 'liquid' };
  assert.equal(family.storedFamily({ getItem: (k) => store[k] ?? null }), 'glass');
  assert.equal(family.storedFamily({ getItem: () => { throw Error('blocked'); } }), 'editorial');
  assert.equal(family.storedFamily(null), 'editorial');
});

test('public/theme.js carries the same families and migration table as the app', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../public/theme.js'), 'utf8');
  const families = JSON.parse(code.match(/const families = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const migration = JSON.parse(code.match(/const migration = (\{[^}]*\})/)[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":'));
  assert.deepEqual(families, [...family.FAMILIES]);
  assert.deepEqual(migration, { ...family.FAMILY_MIGRATION });
  assert.match(code, /'noevia:theme-family'/);
  assert.match(code, /'noevia:material'/);
});

test('before paint and in the app, every stored combination resolves the same way', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../public/theme.js'), 'utf8');
  for (const saved of [null, 'editorial', 'contemporary', 'glass', 'x']) for (const legacy of [null, 'soft', 'material', 'liquid', 'x']) {
    const store = { 'noevia:theme-family': saved, 'noevia:material': legacy };
    const attributes = {};
    vm.runInNewContext(code, {
      localStorage: { getItem: (k) => store[k] ?? null },
      document: { documentElement: { setAttribute: (k, v) => { attributes[k] = v; } }, querySelector: () => null },
    });
    assert.equal(attributes['data-family'], family.resolveFamily(saved, legacy), `${saved}/${legacy}`);
  }
});

test('the family preference writes the new key and the root attribute, never the retired key', () => {
  const attributes = {}, store = {};
  const document = { documentElement: { getAttribute: (k) => attributes[k] ?? null, setAttribute: (k, v) => { attributes[k] = v; } } };
  const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const prefs = load('preferences.ts', { document, localStorage });
  assert.equal(prefs.PREFERENCES.family.key, 'noevia:theme-family');
  assert.equal(prefs.PREFERENCES.family.attribute, 'data-family');
  assert.equal(prefs.PREFERENCES.material, undefined, 'the Material preference is retired');
  prefs.writePreference('family', 'contemporary');
  assert.equal(attributes['data-family'], 'contemporary');
  assert.deepEqual(store, { 'noevia:theme-family': 'contemporary' });
  prefs.writePreference('family', 'soft');
  assert.equal(attributes['data-family'], 'contemporary', 'a retired name is not a family');
  attributes['data-family'] = 'glass';
  assert.equal(prefs.readPreference('family'), 'glass', 'the attribute theme.js resolved is the truth');
});

test('fonts.js loads only the active family, then the rest for previews', () => {
  const code = fs.readFileSync(path.join(__dirname, '../../public/fonts.js'), 'utf8');
  const links = [], listeners = {};
  const context = {
    module: { exports: {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    MutationObserver: class { observe() {} },
    document: {
      documentElement: { getAttribute: () => 'glass' },
      createElement: () => ({ dataset: {} }),
      head: { appendChild: (l) => links.push(l) },
    },
  };
  vm.runInNewContext(code, context);
  assert.equal(links.length, 1);
  assert.match(links[0].href, /family=Manrope/);
  assert.match(links[0].href, /family=Sora/);
  assert.match(links[0].href, /JetBrains\+Mono/);
  assert.match(links[0].href, /display=swap$/);
  listeners['noevia:preview-fonts']();
  assert.deepEqual(links.map((l) => l.dataset.family).sort(), ['contemporary', 'editorial', 'glass']);
  for (const [name, spec] of Object.entries(family.FAMILY_SPECS)) {
    const query = context.module.exports.FAMILY_FONTS[name];
    for (const face of new Set([spec.display, spec.ui])) assert.match(query, new RegExp(`family=${face}:`), `${name} loads ${face}`);
  }
});
