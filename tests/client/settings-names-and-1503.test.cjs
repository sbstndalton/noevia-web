'use strict';
// #1503 (English): the Settings section names used "&" in some places and "and" in others, and the
// Assistant page said "Advanced style · 4 set". Section names now use "and" throughout (the same word
// the references to them use), and the count reads "4 customised" (en-US: "customized").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalogue, English } = require('./i18n-catalogue.cjs');

test('#1503 every Settings section and group name in English uses "and", not "&"', () => {
  const en = English();
  const names = Object.entries(en).filter(([k]) => k.startsWith('settings.section.') || k.startsWith('settings.group.'));
  assert.ok(names.length > 10);
  for (const [key, value] of names) assert.doesNotMatch(value, /&/, `${key}: "${value}"`);
  assert.equal(en['settings.section.models'], 'Models and routing');
  assert.equal(en['settings.section.diary'], 'Diary and storage');
  assert.equal(en['settings.group.account'], 'Account and connections');
});

test('#1503 the English copy that names a section says "and" too', () => {
  const en = English();
  for (const key of ['chat.openModels', 'language.openStyle', 'providers.chatgpt.open', 'appPasswords.connectOpen', 'mm.title']) {
    assert.doesNotMatch(en[key], /&/, key);
  }
  assert.equal(en['language.openStyle'], 'Open Assistant and style');
  assert.equal(en['mm.title'], 'Models and routing');
});

test('#1503 the Settings menu labels in code match the catalogue wording in English', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsShell.tsx'), 'utf8');
  const labels = [...src.matchAll(/\['[a-z]+', '([^']+)'/g)].map((m) => m[1]);
  assert.ok(labels.length >= 15);
  for (const label of labels) assert.doesNotMatch(label, /&/, label);
  assert.match(src, /'Account and connections'/);
});

test('#1503 the advanced style count reads "customised" in British English and "customized" in American', () => {
  assert.equal(catalogue('en-GB')['style.advancedSet'], '{count} customised');
  assert.equal(catalogue('en-US')['style.advancedSet'], '{count} customized');
  assert.equal(catalogue('en-GB')['style.advanced'], 'Advanced style', 'the heading is unchanged');
});
