'use strict';
// #1492: the Usage caption read "heure de UTC" (the article is wrong before a zone name). It now reads
// "à l’heure {zone}", with the same placeholders as English. The rest of the French walk is covered
// by the cross-locale fixes (Passkey and Local inference in #1491, the legacy routing label in #1501).
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue } = require('./i18n-catalogue.cjs');

test('#1492 the French usage caption names the zone without the wrong article', () => {
  const fr = catalogue('fr-FR')['usage.activityIntro'];
  assert.doesNotMatch(fr, /heure de \{zone\}/);
  assert.match(fr, /à l’heure \{zone\}\./);
  assert.equal(fr.match(/\{\w+\}/g).sort().join(' '), catalogue('en-GB')['usage.activityIntro'].match(/\{\w+\}/g).sort().join(' '), 'same placeholders as English');
});
