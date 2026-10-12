'use strict';
// #1485: (1) Connectors' MCP card said servers needing sign-in are "listed below", but nothing is
// listed there, so the sentence is gone from every locale. (2) Settings > Status showed bare dashes
// for speed, requests and VRAM when the engine had nothing to report, with no word for why. The
// reason is now a sentence: no reading yet, engine not responding, or idle.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS_LOCALES, catalogues, load } = require('./settings-catalogue-b4.cjs');

const SETTINGS = catalogues(SETTINGS_LOCALES);
const EN = SETTINGS['en-GB'];

// The word each catalogue used for "below" before this change.
const OLD_BELOW = { 'de-DE': 'unten', 'es-ES': 'abajo', 'fr-FR': 'ci-dessous', 'it-IT': 'qui sotto', 'nb-NO': 'nedenfor', 'nl-NL': 'hieronder', 'pt-BR': 'abaixo', 'sv-SE': 'nedan' };

test('the MCP card no longer promises a list below it, in English or any locale', () => {
  assert.equal(EN['connectors.mcp.summary'], 'Administrators add servers from the MCP directory or by URL, in {section} → {mcp}.');
  assert.ok(!/listed below/.test(EN['connectors.mcp.summary']));
  for (const [locale, word] of Object.entries(OLD_BELOW)) {
    const text = SETTINGS[locale]['connectors.mcp.summary'];
    assert.ok(!new RegExp(`\\b${word}\\b`).test(text), `${locale} no longer says "${word}": ${text}`);
    assert.match(text, /\{section\} → \{mcp\}/, `${locale} keeps the navigation placeholders`);
  }
});

test('the three Live engine notes are translated in every locale', () => {
  for (const key of ['serviceStatus.idle', 'serviceStatus.noReading', 'serviceStatus.notResponding']) {
    assert.ok(EN[key], `${key} exists in English`);
    for (const [locale, catalogue] of Object.entries(SETTINGS)) {
      assert.ok(catalogue[key] && catalogue[key] !== key, `${locale} has ${key}`);
      if (locale !== 'en-GB') assert.notEqual(catalogue[key], EN[key], `${locale} ${key} is translated`);
    }
  }
});

test('liveEngineNote names the reason for each empty state and stays silent when there is a reading', () => {
  const { liveEngineNote } = load('live-engine-note');
  const t = (key) => key;
  assert.equal(liveEngineNote(t, null), 'serviceStatus.noReading', 'no poll result yet');
  assert.equal(liveEngineNote(t, { up: false, tokensPerSecond: null }), 'serviceStatus.notResponding', 'the engine did not answer');
  assert.equal(liveEngineNote(t, { up: true, tokensPerSecond: null }), 'serviceStatus.idle', 'up, but no speed reported');
  assert.equal(liveEngineNote(t, { up: true, tokensPerSecond: 31.4 }), null, 'a reading is shown without a note');
});

test('Settings > Status renders that note above the Live engine figures', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsView.tsx'), 'utf8');
  assert.match(src, /const liveNote = liveEngineNote\(t, stats\);/);
  assert.match(src, /<h2>\{t\('serviceStatus\.liveEngine'\)\}<\/h2>\{liveNote && <p className="route-note" role="status">\{liveNote\}<\/p>\}<div className="settings-stat-row">/);
});
