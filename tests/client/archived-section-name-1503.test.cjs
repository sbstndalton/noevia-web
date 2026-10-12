// #1503: the Archived chats view names the Settings section it links to with the renamed section label
// ('settings.section.data'), not the old 'Your data & privacy', and every interface locale defines that
// label. The view loads the Settings catalogue lazily (#286), so the link appears only once it is registered.
// Synthetic data only; the view is rendered through Vite's SSR pipeline with no network or storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');

async function withServer(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
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

test('every interface locale defines the renamed Settings section label', () => withServer(async (server) => {
  const dir = path.join(SRC, 'i18n/settings');
  // en-US is a partial overlay on en-GB and inherits the label from it, so only full catalogues are checked here.
  const files = fs.readdirSync(dir).filter((f) => /^[a-z]{2}-[A-Z]{2}\.ts$/.test(f) && f !== 'en-US.ts');
  assert.equal(files.length, 9, `found ${files.length} full locale catalogues (en-GB and eight others)`);
  for (const file of files) {
    const mod = await server.ssrLoadModule(`/src/i18n/settings/${file}`);
    const catalogue = Object.values(mod).find((v) => v && typeof v === 'object');
    const label = catalogue?.['settings.section.data'];
    assert.equal(typeof label, 'string', `${file} defines settings.section.data`);
    assert.ok(label.trim().length > 0, `${file} label is not empty`);
  }
  const en = await server.ssrLoadModule('/src/i18n/settings/en-GB.ts');
  assert.equal(en.EN_GB_SETTINGS['settings.section.data'], 'Your data and privacy', 'the English label is the renamed one');
}));

test('the archived view names the section only once its Settings catalogue is registered, then uses the renamed label', () => withServer(async (server) => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const view = await server.ssrLoadModule('/src/components/data/ArchivedChats.tsx');
  const core = await server.ssrLoadModule('/src/i18n/core.ts');
  const render = () => renderToStaticMarkup(React.createElement(view.ArchivedChatsView, { onDelete: async () => true, onOpenData() {} }));
  const before = render();
  assert.doesNotMatch(before, /Export from/, 'no link before the Settings catalogue is registered (the chunk stays out of the first load)');
  assert.doesNotMatch(before, /Your data &amp; privacy|Your data and privacy/);
  await server.ssrLoadModule('/src/i18n/settings/index.ts');
  assert.ok(core.activeSegments().includes('settings'), 'the Settings segment is registered');
  const after = render();
  assert.match(after, /Export from Your data and privacy/, 'the link names the renamed section');
  assert.doesNotMatch(after, /Your data &amp; privacy/, 'the old label is gone');
}));
