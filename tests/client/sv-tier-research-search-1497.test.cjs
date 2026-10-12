'use strict';
// #1497 (sv-SE): the Fast/Smart tier reads Avancerad (the same rule as nb-NO in #1494), "research" is
// Swedish in Deep research, the Swedish spelling "routning" is used for routing in the feature names,
// and the sidebar search placeholder reads "Sök i chattar". Placeholders are kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue, English } = require('./i18n-catalogue.cjs');

const visible = (value) => value.replace(/\{\w+\}/g, '');

test('#1497 sv-SE shows the tier as Avancerad, not the English word Smart', () => {
  const sv = catalogue('sv-SE');
  assert.equal(sv['composer.autoFastSmart'], 'Auto (Snabb/Avancerad)');
  assert.equal(sv['chat.route.name.smart'], 'Avancerad');
  assert.equal(sv['routing.smart'], 'Avancerad: {model}');
  assert.equal(sv['inspector.routingAuto'], 'Auto · Snabb / Avancerad');
  assert.equal(sv['mm.route.needBoth'], 'Auto behöver både en snabb och en avancerad modell.');
  for (const [key, value] of Object.entries(sv)) {
    assert.doesNotMatch(visible(value), /\bsmart\b/i, `sv-SE ${key} has no English tier word`);
  }
});

test('#1497 sv-SE keeps the placeholders of the tier strings it changed', () => {
  const en = English();
  const sv = catalogue('sv-SE');
  const holes = (s) => (s.match(/\{\w+\}/g) || []).slice().sort().join(' ');
  for (const key of ['routing.smart', 'models.roles', 'modelPopup.routingAfter', 'features.item.systemOneRouting.description']) {
    assert.equal(holes(sv[key]), holes(en[key]), `${key} keeps its placeholders`);
  }
});

test('#1497 sv-SE Deep research and tool routing use the Swedish words', () => {
  const sv = catalogue('sv-SE');
  assert.equal(sv['features.item.deepResearch.label'], 'Djupgående forskning');
  assert.doesNotMatch(sv['features.item.deepResearch.description'], /research/i);
  assert.equal(sv['features.item.toolRouter.label'], 'Verktygsroutning');
  assert.match(sv['settings.section.models'], /routning/, 'the models section already uses routning');
});

test('#1497 sv-SE sidebar search placeholder uses the usual phrasing', () => {
  assert.equal(catalogue('sv-SE')['sidebar.searchPlaceholder'], 'Sök i chattar, projekt och sidor…');
});
