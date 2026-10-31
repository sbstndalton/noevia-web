'use strict';
// #2245 (noevia-web#105 review): (1) diaryRequest called without a body is a GET whatever its default `method` says,
// so its failure is not "a write whose outcome is unknown"; (2) "Using previous text" is worded in the interface
// language like the rest of the queued line. Synthetic responses only; no network.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
function load(file, stubs = {}) {
  const exports_ = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, Intl, Number, Object, Error, String, Set, Array, Promise, JSON, require: (m) => stubs[m] || load(path.posix.join(path.posix.dirname(file), m).replace(/^\.\//, '')) });
  return exports_;
}
const seen = [];
const unavailable = { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: 'Diary is unavailable right now. Try again shortly.', code: 'diaryUnavailable' }) };
const { diaryRequest } = load('diary-workspace', {
  './api': { apiFetch: async (url, init) => { seen.push({ url, init }); return unavailable; } },
  './request-cache': { cached: (_k, f) => f(), invalidateCachedPrefix() {} },
});
const failure = async (...args) => { try { await diaryRequest(...args); } catch (e) { return e; } assert.fail('it should have failed'); };

test('#2245: a diaryRequest with no body is a read, so its 503 is not an unknown write', async () => {
  const e = await failure('history');
  assert.equal(e.code, 'diaryUnavailable');
  assert.equal(e.write, false);
  assert.equal(seen.at(-1).init.method, undefined, 'and it was sent as a GET');
});

test('#2245: a write with a body is still a write, and a file read is not', async () => {
  assert.equal((await failure('entries/edit', { xid: 'x' })).write, true);
  assert.equal((await failure('file', { path: 'a.md', content: 'x', version: null }, 'PUT')).write, true);
  assert.equal((await failure('file', { path: 'a.md' })).write, false, 'POST /file is how a file is read');
  assert.equal((await failure('files?path=', undefined, 'GET')).write, false);
});

test('#2245: "Using previous text" follows the interface language, with the English fallback', () => {
  const { sourceStatus } = load('source-status');
  const stale = { name: 'a.pdf', content: 'earlier', document: { state: 'queued', stale: true } };
  const t = (key) => `<${key}>`;
  assert.equal(sourceStatus(stale, t), '<projects.view.usingPreviousText> · <projects.view.reason.extractionWaiting>');
  assert.match(sourceStatus(stale), /^Using previous text · Waiting for document reading/);
  for (const loc of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const m = fs.readFileSync(path.join(SRC, 'i18n', `${loc}.ts`), 'utf8').match(/'projects\.view\.usingPreviousText': "([^"]+)"/);
    assert.ok(m && m[1].trim(), `${loc} words it`);
    if (loc !== 'en-GB') assert.notEqual(m[1], 'Using previous text', `${loc} is not the English text`);
  }
});
