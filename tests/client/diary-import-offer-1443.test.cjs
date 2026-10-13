// #1443: the Diary "Your existing diary still uses its original storage" import offer is for an old
// local diary only. A diary that already lives on connected Nextcloud, WebDAV or S3 storage must not
// be offered a copy. The rule is a pure function of the connected storage kind that DiaryView already
// loads (fetchStorage), so no sidecar or core field is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function withStatus(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' }, visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    return await fn(await server.ssrLoadModule('/src/components/DiaryStorageStatus.tsx'));
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('only an old local diary is offered the import', () => withStatus(({ showsImportOffer }) => {
  assert.equal(showsImportOffer('local'), true);
  for (const connected of ['nextcloud', 'webdav', 's3']) assert.equal(showsImportOffer(connected), false, `${connected} already holds the diary`);
  // Until the connected storage is known, no prompt: a Nextcloud user must never see it flash up.
  assert.equal(showsImportOffer(null), false);
  assert.equal(showsImportOffer(undefined), false);
}));

test('DiaryView hands the connected storage kind to the status block', () => {
  const view = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryView.tsx'), 'utf8');
  const call = view.slice(view.indexOf('<DiaryStorageStatus'), view.indexOf('/>', view.indexOf('<DiaryStorageStatus')));
  assert.match(call, /storageKind=\{storage\?\.kind \?\? null\}/);
});
