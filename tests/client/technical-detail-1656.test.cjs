'use strict';
// #1656: two notes still named an operator environment variable to everyone. The account-step warning named
// ADDITIONAL_TRUSTED_ORIGINS (SetupWizard) and the Browser panel's offline note named CODE_EGRESS_PORT. The plain
// words are for everyone, in every interface locale; the variable name renders only through
// <TechnicalDetail isAdmin={...} />, so an administrator sees it and a member does not. Synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ENV_LIKE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

async function withServer(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: ROOT, server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    return await fn(server);
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('#1656 the account-step warning: a member reads only the plain words, an administrator also reads the variable', () => withServer(async (server) => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PrivateLanOriginNote } = await server.ssrLoadModule('/src/components/SetupWizard.tsx');
  const render = (isAdmin) => renderToStaticMarkup(React.createElement(PrivateLanOriginNote, { isAdmin }));

  const member = render(false);
  assert.match(member, /only works on your local network/, 'the plain warning reaches a member');
  assert.doesNotMatch(member, /ADDITIONAL_TRUSTED_ORIGINS/, 'a member never sees the variable name');
  assert.doesNotMatch(member, ENV_LIKE, 'a member sees no environment-style name at all');

  const admin = render(true);
  assert.match(admin, /only works on your local network/);
  assert.match(admin, /Technical detail: ADDITIONAL_TRUSTED_ORIGINS/, 'an administrator reads the variable');
  assert.match(admin, /role="alert"/, 'the warning keeps its alert role');
}));

test('#1656 the Browser offline note: a member reads only the plain words, an administrator also reads CODE_EGRESS_PORT', () => withServer(async (server) => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { EgressUnavailableNote } = await server.ssrLoadModule('/src/components/browser/BrowserPanel.tsx');
  const render = (isAdmin) => renderToStaticMarkup(React.createElement(EgressUnavailableNote, { isAdmin }));

  const member = render(false);
  assert.match(member, /network proxy is not available, so a browser task cannot open right now/, 'the plain note reaches a member');
  assert.doesNotMatch(member, /CODE_EGRESS_PORT/, 'a member never sees the variable name');
  assert.doesNotMatch(member, ENV_LIKE);
  assert.doesNotMatch(member, /egress proxy/i, 'the jargon is gone from the member copy');

  const admin = render(true);
  assert.match(admin, /network proxy is not available, so a browser task cannot open right now/);
  assert.match(admin, /Technical detail: CODE_EGRESS_PORT/, 'an administrator reads the variable');
  assert.match(admin, /role="status"/, 'the note keeps its status role');
}));

test('#1656 the two surfaces name their variable only inside TechnicalDetail, never in plain copy', () => {
  for (const [rel, env] of [['src/components/SetupWizard.tsx', 'ADDITIONAL_TRUSTED_ORIGINS'], ['src/components/browser/BrowserPanel.tsx', 'CODE_EGRESS_PORT']]) {
    const src = read(rel);
    const outsideProps = src.replace(new RegExp(`name="${env}"`, 'g'), '');
    assert.doesNotMatch(outsideProps, new RegExp(`\\b${env}\\b`), `${rel} names ${env} outside TechnicalDetail`);
    assert.match(src, new RegExp(`<TechnicalDetail isAdmin=\\{isAdmin\\} name="${env}"`), `${rel} passes ${env} through TechnicalDetail`);
  }
  assert.doesNotMatch(read('src/components/SetupWizard.tsx'), /This address only works on your local network/, 'the English copy moved to the catalogue');
  assert.doesNotMatch(read('src/components/browser/BrowserPanel.tsx'), /This server does not run the egress proxy/, 'the English copy moved to the catalogue');
});

test('#1656 the wizard role comes from the mode: only the invited member is not an administrator, and the Browser role is fetched only for the offline note', () => {
  const wizard = read('src/components/SetupWizard.tsx');
  assert.match(wizard, /<PrivateLanOriginNote isAdmin=\{mode !== 'invited'\}\/>/);
  const browser = read('src/components/browser/BrowserPanel.tsx');
  // #2242: a proxy that is configured but not answering is not an administrator's setup, so the role is not fetched for it either.
  assert.match(browser, /const needsAdmin = !!state && state\.network !== true && state\.networkState !== 'unavailable';/);
  assert.match(browser, /fetchProfile\(\)\.then\(p => \{ if \(live\) setIsAdmin\(p\?\.user\?\.role === 'admin'\); \}/);
  assert.match(browser, /<EgressUnavailableNote isAdmin=\{isAdmin\}\/>/);
  assert.match(browser, /\{!online && \(state\.networkState === 'unavailable' \? <EgressTemporaryNote\/> : <EgressUnavailableNote isAdmin=\{isAdmin\}\/>\)\}/);
});

test('#1656 every interface locale has both plain notes, with no placeholder and no environment variable name', () => {
  const keys = ['wizard.originPrivateLan', 'browser.egressUnavailable'];
  for (const locale of LOCALES) {
    const dict = catalogue(locale);
    for (const key of keys) {
      const text = dict[key];
      assert.ok(typeof text === 'string' && text.trim(), `${locale} has ${key}`);
      assert.doesNotMatch(text, ENV_LIKE, `${locale} ${key} names no environment variable`);
      assert.doesNotMatch(text, /\{\w+\}/, `${locale} ${key} has no placeholder to fill`);
    }
  }
  const en = catalogue('en-GB');
  assert.equal(en['browser.egressUnavailable'], 'The network proxy is not available, so a browser task cannot open right now. It may only be restarting; if it stays unavailable, an administrator sets it up in the server configuration.');
  assert.match(en['wizard.originPrivateLan'], /^This address only works on your local network\./);
});
