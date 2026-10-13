'use strict';
// #1526: the sensitivity card names the 'health' flag (a health or diagnosis pre-rule from the core's
// routing-modes.cjs). The flag is part of the RouteFlag type and of the card's label map, and every
// locale catalogue has a real label for it (not the English text copied into another language).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

const LOCALES = ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE'];
const labelFor = (locale) => {
  const m = read(`i18n/${locale}.ts`).match(/'chat\.routing\.flag\.health': "([^"]+)"/);
  return m ? m[1] : null;
};

test('the route flag type includes health beside card and iban', () => {
  assert.match(read('types.ts'), /export type RouteFlag = 'diary' \| 'secret' \| 'iban' \| 'card' \| 'health' \| 'router' \| 'unavailable';/);
});

test('the card maps the health flag to its label key, and the key type includes it', () => {
  const controls = read('components/RouteControls.tsx');
  assert.match(controls, /'chat\.routing\.flag\.card' \| 'chat\.routing\.flag\.health' \| 'chat\.routing\.flag\.router' \| 'chat\.routing\.flag\.unavailable'> = \{/, 'the key union is spelled out');
  assert.match(controls, /\| 'chat\.routing\.flag\.health'/);
  assert.match(controls, /\n  health: 'chat\.routing\.flag\.health',\n/);
});

test('every locale catalogue has a health flag label', () => {
  for (const locale of LOCALES) {
    assert.ok(labelFor(locale), `${locale}.ts has no 'chat.routing.flag.health' label`);
  }
});

test('the health label is a real phrase in each language, not the English copied across', () => {
  const english = labelFor('en-GB');
  assert.equal(english, 'health information');
  for (const locale of LOCALES.filter((l) => l !== 'en-GB')) {
    const text = labelFor(locale);
    assert.notEqual(text, english, `${locale} reuses the English label`);
    assert.ok(text.trim().length > 3, `${locale} label is too short to be a phrase`);
  }
});

test('the pending card reads the flag label through the same map as the other flags', () => {
  const controls = read('components/RouteControls.tsx');
  assert.match(controls, /t\(FLAG_KEY\[flag\] \?\? FLAG_KEY\.unavailable\)/);
});
