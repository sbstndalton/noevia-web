'use strict';
// #1481: Settings > Features said "All start off" while six operator-set features were already on,
// so the intro contradicted the page. The sentence now says what is true (off by default) and points
// at the "Set by the operator" marker the rows already show. Every locale gets its own wording.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS_LOCALES, catalogues } = require('./settings-catalogue-b4.cjs');

const SETTINGS = catalogues(SETTINGS_LOCALES);

// The sentence each catalogue carried before this change, in its own language.
const OLD_INTRO = {
  'de-DE': 'Alle sind anfangs ausgeschaltet',
  'es-ES': 'Todas empiezan desactivadas',
  'fr-FR': 'Toutes sont désactivées au départ',
  'it-IT': 'Tutte partono disattivate',
  'nb-NO': 'Alle starter avslått',
  'nl-NL': 'Ze staan allemaal standaard uit',
  'pt-BR': 'Todos começam desativados',
  'sv-SE': 'Alla börjar avstängda',
};

test('the English intro states the default and names the operator marker, with no blanket "All start off"', () => {
  const intro = SETTINGS['en-GB']['features.intro'];
  assert.ok(!/All start off/.test(intro), intro);
  assert.match(intro, /Off by default\./);
  assert.match(intro, /“Set by the operator”/, 'the row marker the page shows is named exactly');
  assert.match(intro, /can't be changed here\./);
});

test('every locale has its own intro, not the English copy, and drops its old blanket claim', () => {
  for (const [locale, old] of Object.entries(OLD_INTRO)) {
    const text = SETTINGS[locale]['features.intro'];
    assert.ok(text && text.length > 40, `${locale} has an intro`);
    assert.notEqual(text, SETTINGS['en-GB']['features.intro'], `${locale} is translated, not English`);
    assert.ok(!text.includes(old), `${locale} no longer says "${old}"`);
  }
});
