'use strict';
// sbstndalton/noevia#2400: a retention setting that failed to load must not read "Never". The select has no chosen value
// and shows a translated placeholder until the setting is loaded (browser proof: qa/retention-unknown-2400.cjs).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/data/RetentionSetting.tsx'), 'utf8');

test('noevia#2400 the select takes its value from the loaded state only', () => {
  assert.doesNotMatch(src, /state\?\.days \?\? 0/, 'no default of 0 ("Never") while the setting is unknown');
  assert.match(src, /value=\{state \? state\.days : ''\}/);
  assert.match(src, /\{!state && <option value="" disabled>\{t\('data\.retentionUnknown'\)\}<\/option>\}/);
});

test('noevia#2400 every locale words the placeholder, differently from "Never"', () => {
  for (const locale of LOCALES) {
    const c = catalogue(locale);
    assert.ok(c['data.retentionUnknown'], `${locale} has data.retentionUnknown`);
    assert.notEqual(c['data.retentionUnknown'], c['data.never'], `${locale}: the placeholder is not the "Never" label`);
  }
});
