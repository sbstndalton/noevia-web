// #1594: after a multi-branch integration 104 English strings were missing from the other catalogues and
// showed in English in every other language (translate() falls back to en-GB). Every en-GB key must exist in
// every other catalogue (en-US is a thin override and exempt) with the same {placeholders}, so a merge or a
// branch that adds a key without translating it fails CI.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const english = catalogue('en-GB');
const placeholders = (s) => [...new Set(s.match(/\{[A-Za-z0-9_]+\}/g) ?? [])].sort().join(',');

test('the en-GB catalogue loads (so an empty comparison cannot pass)', () => {
  assert.ok(Object.keys(english).length > 1000);
});

for (const locale of LOCALES.filter((l) => l !== 'en-GB')) {
  test(`${locale} has every en-GB key`, () => {
    const mine = catalogue(locale);
    const missing = Object.keys(english).filter((k) => !(k in mine));
    assert.deepEqual(missing, [], `${locale} is missing ${missing.length} key(s): ${missing.slice(0, 20).join(', ')}`);
  });

  test(`${locale} keeps the same placeholders as en-GB`, () => {
    const mine = catalogue(locale);
    const wrong = Object.keys(english).filter((k) => k in mine && placeholders(english[k]) !== placeholders(mine[k]));
    assert.deepEqual(wrong, [], `${locale} changes placeholders in: ${wrong.join(', ')}`);
  });
}
