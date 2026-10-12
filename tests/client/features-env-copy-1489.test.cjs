'use strict';
// #1489: Settings > Features showed operator environment variable names (NOEVIA_FEATURE_*, and
// TRUST_PROXY, CODE_HARNESS_ENDPOINT, COWORK_DECISION_URL in the "unavailable" reasons) to every user,
// in every locale. The lock line is now just "Set by the operator", and the reasons name the
// capability, not the variable. Variable names stay in the operator documentation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const ENV_LIKE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

test('#1489 the Features row no longer passes the variable name into the lock line', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/features/FeatureSettings.tsx'), 'utf8');
  assert.match(src, /t\('features\.lockedBy'\)/);
  assert.doesNotMatch(src, /features\.lockedBy', \{ env/);
});

test('#1489 every locale names the operator lock without a {env} placeholder or a variable name', () => {
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    assert.ok(cat['features.lockedBy'], `${locale} has features.lockedBy`);
    assert.doesNotMatch(cat['features.lockedBy'], /\{env\}/, `${locale} lock line has no {env}`);
    assert.doesNotMatch(cat['features.lockedBy'], ENV_LIKE, `${locale} lock line shows no variable name`);
  }
});

test('#1489 no Features copy in any locale shows an environment variable name', () => {
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    for (const [key, value] of Object.entries(cat)) {
      if (!key.startsWith('features.')) continue;
      assert.doesNotMatch(value, ENV_LIKE, `${locale} ${key} shows "${value.match(ENV_LIKE)?.[0]}"`);
      assert.doesNotMatch(value, /NOEVIA_|COWORK_/, `${locale} ${key}`);
    }
  }
});

test('#1489 the unavailable reasons still say what to do', () => {
  const en = catalogue('en-GB');
  assert.match(en['features.unavailable.decisionUrl'], /decision service/);
  assert.match(en['features.unavailable.trustProxy'], /reverse-proxy/);
  assert.match(en['features.unavailable.codeSandbox'], /code sandbox/);
  const de = catalogue('de-DE');
  assert.equal(de['features.lockedBy'], 'Vom Betreiber festgelegt.');
});
