// #2241 (locale item): the language choices in Settings (LOCALE_OPTIONS, src/user-preferences.ts) are 'system' plus exactly the
// locales the interface can load (SUPPORTED, src/i18n/core.ts), in the same order. The two lists lived apart and matched only by
// hand: a locale added to one and not the other would be offered with no catalogue, or have one and never be offered.
// Both modules are loaded through Vite's SSR pipeline; synthetic environment, no network or storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function withServer(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try { return await fn(server); }
  finally { delete global.window; delete global.document; delete global.localStorage; delete global.navigator; await server.close(); }
}

test('LOCALE_OPTIONS is system plus SUPPORTED, in order, each with a name', () => withServer(async (server) => {
  const { LOCALE_OPTIONS } = await server.ssrLoadModule('/src/user-preferences.ts');
  const { SUPPORTED } = await server.ssrLoadModule('/src/i18n/core.ts');
  assert.deepEqual(LOCALE_OPTIONS.map(([id]) => id), ['system', ...SUPPORTED]);
  for (const [id, label] of LOCALE_OPTIONS) assert.ok(typeof label === 'string' && label.trim(), `${id} has a visible name`);
  assert.equal(new Set(LOCALE_OPTIONS.map(([id]) => id)).size, LOCALE_OPTIONS.length, 'no locale is listed twice');
}));
