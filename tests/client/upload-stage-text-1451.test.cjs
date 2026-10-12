// #1451: the upload stage lines the client words itself ("Waiting for another file to finish processing",
// "Sending file", ...) were hard-coded English in every language. uploadStageText words them from the
// catalogue by key; a stage the server worded is shown as it sent it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withModules(run) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom' });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try { await run(server); } finally { delete global.window; delete global.document; delete global.localStorage; delete global.navigator; await server.close(); }
}

test('each client stage is worded from the catalogue in the language asked for', () => withModules(async (server) => {
  const core = await server.ssrLoadModule('/src/i18n/core.ts');
  const { uploadStageText } = await server.ssrLoadModule('/src/source-status.ts');
  const { EN_GB } = await server.ssrLoadModule('/src/i18n/en-GB.ts');
  const { DE_DE } = await server.ssrLoadModule('/src/i18n/de-DE.ts');
  core.registerCatalogue('en-GB', EN_GB); core.registerCatalogue('de-DE', DE_DE);
  const say = (locale) => (key, params) => core.translate(locale, key, params);
  const stages = { busy: 'Waiting for another file to finish processing', sending: 'Sending file', received: 'Upload received · waiting for processing', queued: 'Queued for processing', saved: 'Saved' };
  for (const [stageKey, english] of Object.entries(stages)) {
    assert.equal(uploadStageText(say('en-GB'), { stage: english, stageKey }), english, `${stageKey} in English`);
    const german = uploadStageText(say('de-DE'), { stage: english, stageKey });
    assert.notEqual(german, english, `${stageKey} is translated into German`);
  }
  assert.equal(uploadStageText(say('de-DE'), { stage: 'Extracting pages' }), 'Extracting pages', 'a stage the server worded is shown as sent');
}));
