'use strict';
// #1498: the Capabilities (status) page and the Features page had the same translated name in it-IT,
// nb-NO, sv-SE and pt-BR, so two rows in the Settings menu read alike. Every settings section name must
// be distinct within a locale, and Capabilities has its own word in each of those four locales.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

test('#1498 no two Settings sections share a name in any locale', () => {
  for (const locale of LOCALES) {
    const seen = new Map();
    for (const [key, value] of Object.entries(catalogue(locale))) {
      if (!key.startsWith('settings.section.')) continue;
      assert.ok(!seen.has(value), `${locale}: ${key} and ${seen.get(value)} are both "${value}"`);
      seen.set(value, key);
    }
  }
});

test('#1498 Capabilities and Features are named differently in the four locales that collided', () => {
  const expected = { 'it-IT': 'Capacità (stato)', 'nb-NO': 'Evner (status)', 'sv-SE': 'Förmågor (status)', 'pt-BR': 'Capacidades (status)' };
  for (const [locale, name] of Object.entries(expected)) {
    const cat = catalogue(locale);
    assert.equal(cat['settings.section.capabilities'], name, locale);
    assert.notEqual(cat['settings.section.capabilities'], cat['settings.section.features'], `${locale} features differ`);
  }
});
