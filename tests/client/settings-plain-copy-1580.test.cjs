'use strict';
// #1580: Settings showed operator environment variable names (MCP_SERVERS, GOOGLE_OAUTH_CLIENT_ID),
// internal service names (kiwix-serve), an internal host in the decision-service field (laya) and
// build-status copy ("not built yet", "unbuilt", "not in this image") to every user. The main text is
// plain words in every locale; the variable names stay in the operator documentation. Synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ENV_LIKE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

// The Settings keys this batch changes. Two rows are not here: the preview row and the Offline Wikipedia
// row are pinned to the server registry's English (noevia-core tests/server/i18n-617-619.test.cjs compares
// en-GB with the registry), so they change together with that registry text in noevia-core.
const CHANGED = [
  'features.unavailable.browserPlaywright',
  'features.unavailable.browserChromium',
  'profile.avatarDesc',
  'connectors.drive.unavailableAdmin',
  'serviceStatus.mcp.notConfigured',
  'serviceStatus.mcp.unconfigured2',
];
const SETTINGS_PREFIXES = ['features.', 'connectors.', 'serviceStatus.', 'profile.', 'decision.'];

test('#1580 no Settings copy in any locale shows an environment variable name', () => {
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    for (const [key, value] of Object.entries(cat)) {
      if (!SETTINGS_PREFIXES.some((p) => key.startsWith(p))) continue;
      assert.doesNotMatch(value, ENV_LIKE, `${locale} ${key} shows "${(value.match(ENV_LIKE) || [])[0]}"`);
    }
  }
});

test('#1580 the changed rows name no internal component in any locale', () => {
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    for (const key of CHANGED) assert.doesNotMatch(cat[key], /kiwix|laya|playwright/i, `${locale} ${key} names an internal component`);
  }
});

test('#1580 the English copy for the changed Settings rows says what a person can do, not what the build lacks', () => {
  const en = catalogue('en-GB');
  for (const key of CHANGED) assert.ok(typeof en[key] === 'string' && en[key].trim(), `en-GB has ${key}`);
  assert.match(en['features.unavailable.browserPlaywright'], /^Not available on this server yet/);
  assert.doesNotMatch(en['features.unavailable.browserPlaywright'], /Playwright|image/);
  assert.doesNotMatch(en['features.unavailable.browserChromium'], /Playwright|Chromium/);
  assert.doesNotMatch(en['profile.avatarDesc'], /not built/);
  assert.match(en['profile.avatarDesc'], /isn’t available yet/);
  assert.doesNotMatch(en['connectors.drive.unavailableAdmin'], /GOOGLE_OAUTH|build/);
  assert.match(en['connectors.drive.unavailableAdmin'], /administrator/i);
  assert.doesNotMatch(en['serviceStatus.mcp.notConfigured'], /MCP_SERVERS/);
  assert.equal(en['serviceStatus.mcp.notConfigured'], 'Not set up on this server');
});

test('#1580 every interface locale has its own wording for each changed row, not the English copy', () => {
  const en = catalogue('en-GB');
  for (const locale of LOCALES) {
    if (locale === 'en-GB') continue;
    const cat = catalogue(locale);
    for (const key of CHANGED) {
      assert.ok(typeof cat[key] === 'string' && cat[key].trim(), `${locale} has ${key}`);
      assert.notEqual(cat[key], en[key], `${locale} ${key} is translated`);
    }
  }
});

test('#1580 the unconfigured MCP note keeps its sentence, and names no id format or variable outside the administrator line', () => {
  const src = read('src/components/McpStatus.tsx');
  assert.doesNotMatch(src, /id\|url\|auth/, 'the entry format is no longer listed');
  assert.match(src, /\{t\('serviceStatus\.mcp\.unconfigured1'\)\}<code>core<\/code>\{t\('serviceStatus\.mcp\.unconfigured2'\)\}/);
  assert.equal(src.replace(/name="MCP_SERVERS"/g, '').indexOf('MCP_SERVERS'), -1, 'the variable appears only as the administrator detail');
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    assert.equal(cat['serviceStatus.mcp.unconfigured3'], undefined, `${locale} has no unconfigured3 left`);
    assert.equal(cat['serviceStatus.mcp.unconfigured4'], undefined, `${locale} has no unconfigured4 left`);
  }
});

test('#1580 the decision-service field shows a private example address, not an internal host name', () => {
  const src = read('src/components/features/DecisionServiceSettings.tsx');
  assert.doesNotMatch(src, /placeholder="http:\/\/laya/, 'the empty field no longer shows the internal host');
  assert.match(src, /placeholder="http:\/\/192\.168\.1\.20:8040"/);
});

test('#1580 the Features rows print the variable only as the administrator detail, never in the main text', () => {
  const src = read('src/components/features/FeatureSettings.tsx');
  assert.equal(src.replace(/name=\{f\.env\}/g, '').indexOf('f.env'), -1, 'f.env is read only by the administrator line');
});
