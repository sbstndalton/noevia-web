'use strict';
// #1494 (nb-NO): the Fast/Smart tier name is translated everywhere it is shown (composer, chat row,
// model popup, Models page), and "research" is Norwegian in the Deep research feature. The same rule
// is applied to sv-SE in #1497. Placeholders ({model}, {fast}, {smart}) are kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue, English } = require('./i18n-catalogue.cjs');

const ENGLISH_TIER = /\bsmart\b/i;
const ENGLISH_RESEARCH = /\bresearch\b/i;
const visible = (value) => value.replace(/\{\w+\}/g, '');

test('#1494 nb-NO shows the tier as Avansert, not the English word Smart', () => {
  const nb = catalogue('nb-NO');
  assert.equal(nb['composer.autoFastSmart'], 'Auto (Rask/Avansert)');
  assert.equal(nb['chat.route.name.smart'], 'Avansert');
  assert.equal(nb['routing.smart'], 'Avansert: {model}');
  assert.equal(nb['inspector.routingAuto'], 'Auto · Rask / Avansert');
  assert.equal(nb['models.roles'], 'Rask: {fast} · Avansert: {smart}');
  for (const [key, value] of Object.entries(nb)) {
    assert.doesNotMatch(visible(value), ENGLISH_TIER, `nb-NO ${key} has no English tier word`);
  }
});

test('#1494 nb-NO keeps the placeholders of every tier string it changed', () => {
  const en = English();
  const nb = catalogue('nb-NO');
  for (const key of ['routing.smart', 'models.roles', 'modelPopup.routingAfter', 'features.item.systemOneRouting.description']) {
    const holes = (s) => (s.match(/\{\w+\}/g) || []).slice().sort().join(' ');
    assert.equal(holes(nb[key]), holes(en[key]), `${key} keeps its placeholders`);
  }
});

test('#1494 nb-NO Deep research is named without the English word', () => {
  const nb = catalogue('nb-NO');
  assert.equal(nb['features.item.deepResearch.label'], 'Dybdeforskning');
  for (const key of ['features.item.deepResearch.label', 'features.item.deepResearch.description']) {
    assert.doesNotMatch(nb[key], ENGLISH_RESEARCH, key);
  }
});
