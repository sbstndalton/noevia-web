'use strict';
// #1580 review: the plain main text stays for everyone, but an administrator can still see the operator's
// technical name (an environment variable) for a setting. Members must never see one. The names are
// rendered only through <TechnicalDetail isAdmin={...} name="..."/>, and each place that renders it takes
// the role from the signed-in profile (or from its parent, which already gates on it). Synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ENV_NAMES = ['CODE_HARNESS_ENDPOINT', 'CODE_REPOS', 'GOOGLE_OAUTH_CLIENT_ID', 'MCP_SERVERS'];
const SURFACES = [
  'src/components/features/FeatureSettings.tsx',
  'src/components/connectors/ConnectorsSettings.tsx',
  'src/components/McpStatus.tsx',
  'src/components/code/CodePanel.tsx',
  'src/components/features/DecisionServiceSettings.tsx',
];

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

test('#1580 an administrator sees the technical name, a member sees nothing (rendered component, both roles)', () => withServer(async (server) => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TechnicalDetail } = await server.ssrLoadModule('/src/components/TechnicalDetail.tsx');
  const render = (isAdmin) => renderToStaticMarkup(React.createElement(TechnicalDetail, { isAdmin, name: 'MCP_SERVERS', className: 'route-note' }));
  const admin = render(true);
  assert.match(admin, /Technical detail: MCP_SERVERS/, 'the administrator reads the variable');
  assert.match(admin, /class="route-note"/);
  assert.equal(render(false), '', 'a member gets no markup at all');
  assert.equal(renderToStaticMarkup(React.createElement(TechnicalDetail, { isAdmin: true, name: '' })), '', 'nothing to show without a name');
}));

test('#1580 every technical name is rendered only through the administrator-only line, never in plain text', () => {
  for (const rel of SURFACES) {
    const src = read(rel);
    const outsideProps = src.replace(/name="[A-Z_]+"/g, '').replace(/name=\{f\.env\}/g, '');
    for (const env of ENV_NAMES) assert.doesNotMatch(outsideProps, new RegExp(`\\b${env}\\b`), `${rel} shows ${env} outside TechnicalDetail`);
    assert.doesNotMatch(outsideProps, /\{f\.env\}/, `${rel} prints the variable name for every role`);
  }
});

test('#1580 the Features rows take the role from Settings and show the variable only to an administrator', () => {
  const rows = read('src/components/features/FeatureSettings.tsx');
  assert.match(rows, /export function FeatureSettings\(\{ experimental = false, isAdmin = false \}/, 'a member is the default');
  assert.match(rows, /<TechnicalDetail isAdmin=\{isAdmin\} name=\{f\.env\} className="set-row-desc" \/>/);
  const shell = read('src/components/SettingsShell.tsx');
  assert.match(shell, /<FeatureSettings key=\{section\} experimental=\{section === 'experimental'\} isAdmin=\{isAdmin\} \/>/);
});

test('#1580 the Connectors admin note shows the variable only to an administrator', () => {
  const src = read('src/components/connectors/ConnectorsSettings.tsx');
  assert.match(src, /<TechnicalDetail isAdmin=\{isAdmin\} name="GOOGLE_OAUTH_CLIENT_ID" className="row-desc" \/>/);
  assert.match(src, /\{isAdmin \? t\('connectors\.drive\.unavailableAdmin'\) : t\('connectors\.drive\.unavailableMember'\)\}/);
});

test('#1580 the MCP note reads the role from the cached profile and shows the variable only to an administrator', () => {
  const src = read('src/components/McpStatus.tsx');
  assert.match(src, /fetchProfile\(\)\.then\(p=>\{if\(live\)setIsAdmin\(p\?\.user\?\.role==='admin'\);\}/);
  assert.match(src, /<TechnicalDetail isAdmin=\{isAdmin\} name="MCP_SERVERS" className="route-note"\/>/);
});

test('#1580 the Code panel fetches the role only where its note needs it, and shows the variable only to an administrator', () => {
  const src = read('src/components/code/CodePanel.tsx');
  assert.match(src, /const needsAdmin = !!state && \(!state\.sandboxed \|\| state\.repositories\.length === 0 \|\| \(state\.network !== true && state\.networkState === 'unavailable'\)\);/);
  assert.match(src, /fetchProfile\(\)\.then\(p => \{ if \(live\) setIsAdmin\(p\?\.user\?\.role === 'admin'\); \}/);
  assert.match(src, /<TechnicalDetail isAdmin=\{isAdmin\} name="CODE_HARNESS_ENDPOINT"/);
  assert.match(src, /<TechnicalDetail isAdmin=\{isAdmin\} name="CODE_REPOS"/);
});

test('#1580 every interface locale has the administrator line, with exactly one {name} placeholder', () => {
  for (const locale of LOCALES) {
    const text = catalogue(locale)['common.technicalDetail'];
    assert.ok(typeof text === 'string' && text.trim(), `${locale} has common.technicalDetail`);
    assert.deepEqual(text.match(/\{\w+\}/g), ['{name}'], `${locale} keeps the {name} placeholder`);
  }
  assert.equal(catalogue('en-GB')['common.technicalDetail'], 'Technical detail: {name}');
});
