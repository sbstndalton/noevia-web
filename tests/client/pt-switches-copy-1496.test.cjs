'use strict';
// #1496 (pt-BR): the Notifications note called the on/off switches "chaves" (keys), a word the same
// page uses for API keys. It now says "interruptores". The Plugins name in the connectors sentence
// is covered by the customise tab rename (draft/sweep-b5), and the legacy routing label by #1501.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue } = require('./i18n-catalogue.cjs');

test('#1496 the Notifications note refers to the switches as interruptores, not chaves', () => {
  const pt = catalogue('pt-BR')['notifications.inAppNote'];
  assert.match(pt, /destes interruptores\./);
  assert.doesNotMatch(pt, /chaves/);
});

test('#1496 the same note still says the in-app notices ignore the switches', () => {
  const en = catalogue('en-GB')['notifications.inAppNote'];
  assert.match(en, /not affected by these switches/);
  assert.equal(catalogue('pt-BR')['notifications.inAppNote'].includes('não dependem'), true);
});
