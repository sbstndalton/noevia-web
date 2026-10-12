'use strict';
// #1483: Security & login listed sessions with a last-seen date and no end date. Each row now says
// when the session ends (the server sends expiresAt as the earlier of its absolute and idle limits),
// in every locale, next to the revoke button that already sits on the row.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS_LOCALES, catalogues } = require('./settings-catalogue-b4.cjs');

const SETTINGS = catalogues(SETTINGS_LOCALES);

test('the English row copy shows the end of the session next to the last-seen date', () => {
  assert.equal(SETTINGS['en-GB']['security.expires'], 'expires {date}');
  assert.equal(SETTINGS['en-GB']['security.lastSeen'], 'last seen {date}');
});

test('every locale translates the expiry label and keeps its date placeholder', () => {
  for (const [locale, catalogue] of Object.entries(SETTINGS)) {
    const text = catalogue['security.expires'];
    assert.match(text, /\{date\}/, `${locale} takes the date`);
    if (locale !== 'en-GB') assert.notEqual(text, SETTINGS['en-GB']['security.expires'], `${locale} is translated`);
  }
});

test('the session row renders expiresAt from the server, not only lastSeenAt', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsView.tsx'), 'utf8');
  assert.match(src, /t\('security\.expires', \{ date: new Date\(s\.expiresAt\)\.toLocaleString\(appLocale\(\)\) \}\)/);
  assert.match(src, /title=\{t\('security\.revokeSession'\)\}/, 'revoke stays one click on the same row');
});
