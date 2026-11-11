'use strict';
// sbstndalton/noevia#2326: the inference banner keeps the sentence's closing punctuation with its Settings link, in every
// locale's wording. Browser proof of the wrap at 375 px: qa/offline-banner-wrap-2326.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

test('noevia#2326 the link and the punctuation after it share one no-wrap span', () => {
  const view = read('src/components/ChatView.tsx');
  assert.match(view, /const closing = part\.match\(\/\^\\S\*\/\)\?\.\[0\] \?\? '';/);
  assert.match(view, /<span key="settings" className="conn-banner-tail"><button className="conn-banner-link"[^>]*>\{t\('chat\.offline\.settings'\)\}<\/button>\{closing\}<\/span>/);
  assert.match(read('src/styles/overlays.css'), /\.conn-banner-tail \{ white-space: nowrap; \}/);
});

test('noevia#2326 in every locale only the closing punctuation is held to the link, never a clause', () => {
  for (const locale of LOCALES) {
    const sentence = catalogue(locale)['chat.offline.check'];
    const after = sentence.split('{settings}')[1];
    assert.ok(after !== undefined, `${locale}: the sentence places the link`);
    assert.ok(/^\S*/.exec(after)[0].length <= 2, `${locale}: what follows the link without a space is at most punctuation (${JSON.stringify(after)})`);
  }
});
