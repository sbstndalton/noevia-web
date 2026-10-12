'use strict';
// #1499: the Experimental page and the chat pause message used the internal names System-One, Laya,
// Step supervision and Tool gate in every locale. The labels now say what each thing does (routing
// decisions, step checks, tool checks), the decision service is explained in one line, and no
// user-facing copy in the Experimental or decision-service strings names the internal products.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue, English, LOCALES } = require('./i18n-catalogue.cjs');

const INTERNAL = /Laya|System-One|System One|Step supervision|Tool gate|Gate degli|Werkzeug-Gate|Portão de|Puerta de|Portail d’outils|Verktygsgrind|verktøyport|toolpoort/i;
const SCOPED = (key) => /^(decision\.|chat\.paused\.supervision|features\.item\.(stepSupervision|systemOneRouting|toolGate)\.label$|features\.unavailable\.(systemOneUrl|decisionSetup))/.test(key);

test('#1499 the Experimental and chat-pause copy names no internal product in any locale', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(catalogue(locale))) {
      if (!SCOPED(key)) continue;
      assert.doesNotMatch(value, INTERNAL, `${locale} ${key}: "${value}"`);
    }
  }
});

test('#1499 the English labels say what the three experiments do', () => {
  const en = English();
  assert.equal(en['features.item.systemOneRouting.label'], 'Routing decisions');
  assert.equal(en['features.item.stepSupervision.label'], 'Step checks');
  assert.equal(en['features.item.toolGate.label'], 'Tool checks');
  assert.match(en['chat.paused.supervision'], /^Step checks paused this reply/);
});

test('#1499 the decision service is explained in one line, without the internal name', () => {
  const en = English();
  assert.match(en['decision.endpointHelp'], /^The decision service is a small private API that picks where each message goes\./);
  assert.doesNotMatch(en['decision.endpointHelp'], /Laya/);
  assert.equal(en['decision.useLaya'], 'Use installed decision service');
  assert.doesNotMatch(en['decision.msg.invalidUrl'], /laya/i);
});

test('#1499 every locale keeps the placeholders of the pause messages', () => {
  const en = English();
  const holes = (s) => (s.match(/\{\w+\}/g) || []).slice().sort().join(' ');
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    for (const key of ['chat.paused.supervisionApplied.one', 'chat.paused.supervisionApplied.other']) {
      assert.equal(holes(cat[key]), holes(en[key]), `${locale} ${key} keeps {count}`);
    }
  }
});

test('#1499 sv-SE decision copy uses the Swedish spelling routning, as the rest of the page', () => {
  assert.doesNotMatch(catalogue('sv-SE')['decision.intro'], /routing\b/);
  assert.match(catalogue('sv-SE')['decision.intro'], /routning/);
  assert.equal(catalogue('sv-SE')['features.item.systemOneRouting.label'], 'Routningsbeslut');
});
