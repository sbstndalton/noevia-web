'use strict';
// sbstndalton/noevia#2488: the conflict banner says what "Keep mine" does. Copy only, in every locale; no behaviour change.
// Browser proof: qa/spaces-editor-2446.cjs (the 409 check).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

test('noevia#2488 the conflict copy exists in every locale and differs from the English base', () => {
  const en = catalogue('en-GB');
  for (const key of ['spaces.conflictBody', 'spaces.keepMine', 'spaces.takeTheirs', 'spaces.conflictNote']) {
    assert.ok(en[key], `en-GB: ${key}`);
    for (const locale of LOCALES.filter((l) => l !== 'en-GB')) {
      const c = catalogue(locale);
      assert.ok(c[key], `${locale}: ${key}`);
      assert.notEqual(c[key], en[key], `${locale}: ${key} is translated`);
    }
  }
});

test('noevia#2488 English: the banner says the page changed since it was opened; the buttons say what they do; nothing is replaced until chosen', () => {
  const en = catalogue('en-GB');
  assert.match(en['spaces.conflictBody'], /changed somewhere else after you opened it/);
  assert.match(en['spaces.keepMine'], /^Keep mine: replace the newer version$/);
  assert.match(en['spaces.takeTheirs'], /^Take theirs: discard my changes here$/);
  assert.equal(en['spaces.conflictNote'], 'Nothing is replaced until you choose.');
  assert.doesNotMatch(en['spaces.conflictBody'], /Nothing was overwritten/, 'the old merge-sounding line is gone');
});

test('noevia#2488 the note sits under the buttons', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/spaces/PageEditor.tsx'), 'utf8');
  assert.match(src, /space-banner-actions">[\s\S]*?controller\.takeTheirs[\s\S]*?<\/div>\s*<p className="space-banner-note">\{t\('spaces\.conflictNote'\)\}<\/p>/);
});
