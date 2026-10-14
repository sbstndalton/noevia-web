'use strict';
// #1653 (review of core#91 / web#41): a "saved as a copy" notice was lost when any file of the batch failed; a
// stale name list could resend the full base64 body up to 50 times; the give-up error was English-only; and the
// web's mirror of the server's folder key did not know the hashed key a long project id now gets. Synthetic data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const ROOT = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { uploadUnderFreeName, storageFolderKeepsOldName, FREE_NAME_ATTEMPTS } = load('src/project-files.ts');

test('#1653 a name the server keeps refusing is given up after 10 attempts, not 50, so the body is not resent 50 times', async () => {
  assert.equal(FREE_NAME_ATTEMPTS, 10);
  let calls = 0;
  const err = await uploadUnderFreeName('notes.md', [], async () => { calls++; throw Object.assign(new Error('exists'), { code: 'sourceExists' }); }).catch((e) => e);
  assert.equal(calls, 10);
  assert.equal(err.code, 'noFreeName', 'the give-up error carries a code the interface translates');
});

test('#1653 the give-up error is translated in every interface locale', () => {
  for (const locale of LOCALES) {
    const text = catalogue(locale)['upload.noFreeName'];
    assert.ok(typeof text === 'string' && text.trim(), `${locale} has upload.noFreeName`);
    assert.doesNotMatch(text, /\{\w+\}/, `${locale} has no placeholder to fill`);
  }
  assert.match(read('src/source-status.ts'), /noFreeName: \{ key: 'upload\.noFreeName'/);
});

async function withServer(fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: ROOT, server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try { return await fn(server); } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('#1653 a batch where one file fails still says which file was saved as a numbered copy', () => withServer(async (server) => {
  const { uploadSummaryText } = await server.ssrLoadModule('/src/components/ComposerActions.tsx');
  const t = (key, params = {}) => `${key}${JSON.stringify(params)}`;
  t.plural = (key, n, params = {}) => `${key}#${n}${JSON.stringify(params)}`;
  const notice = 'report.pdf was saved as report (2).pdf';
  const partial = uploadSummaryText({ t, total: 2, problems: ['bad.bin: refused'], notices: [notice], target: 'P', where: 'W' });
  assert.match(partial, /composer\.upload\.partial/);
  assert.ok(partial.includes(notice), 'the copy notice survives a partial failure');
  const none = uploadSummaryText({ t, total: 1, problems: ['bad.bin: refused'], notices: [], target: 'P', where: 'W' });
  assert.match(none, /composer\.upload\.notSaved/);
  assert.ok(!none.includes(' · '), 'no stray separator without notices');
  const ok = uploadSummaryText({ t, total: 1, problems: [], notices: [notice], target: 'P', where: 'W' });
  assert.ok(ok.includes(notice));
}));

test('#1653 a folder keyed by a long project id (hashed tail) is never mistaken for an old name-keyed folder', () => {
  const id = 'chat-context-'.padEnd(90, 'c');
  // What the server's projectFolderKey makes of an id longer than 80: the first 67 characters, '-', 12 hex.
  const key = `${id.slice(0, 67)}-0123456789ab`;
  assert.equal(storageFolderKeepsOldName(`noevia projects/${key}`, 'Renamed project', id), false);
  assert.equal(storageFolderKeepsOldName(`noevia projects/${key} (2)`, 'Renamed project', id), false);
  // A short id keeps today's exact key and behaviour.
  assert.equal(storageFolderKeepsOldName('noevia projects/proj-1', 'Renamed', 'proj-1'), false);
  assert.equal(storageFolderKeepsOldName('noevia projects/Old name', 'Renamed', 'proj-1'), true);
  // Another long id's hashed folder is not this project's.
  assert.equal(storageFolderKeepsOldName(`noevia projects/${'other-'.padEnd(67, 'o')}-0123456789ab`, 'Renamed', id), true);
});
