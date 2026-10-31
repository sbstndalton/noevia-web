'use strict';
// noevia#2252 / #2245 (core#360 review): a Diary read the storage server throttles answers 503 `storageThrottled` with `retryAfter`
// (seconds) in the body and in `Retry-After`. getJson kept the code but dropped the wait, so the Diary page said "try again later"
// without how long. The error now carries `retryAfter`, and diaryErrorText words it. Synthetic responses only; no network.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file, globals = {}) {
  if (cache[file] && file !== 'api') return cache[file];
  const exports_ = {}; cache[file] = exports_; // api is loaded afresh per response: it closes over its fetch
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const idle = new Proxy(function () {}, { get: () => idle, apply: () => undefined });
  const stubs = { './request-cache': { cached: (_k, f) => f(), invalidateCached() {}, clearRequestCache() {} } };
  vm.runInNewContext(code, {
    exports: exports_, Intl, Number, Object, Error, String, Set, Array, Promise, JSON, Date, Math, URL, URLSearchParams, Map, RegExp, parseInt, parseFloat, isFinite, Symbol, Event: class {},
    document: { cookie: '' }, window: { dispatchEvent() {}, addEventListener() {} }, Headers: class { constructor(h) { this.h = new Map(Object.entries(h || {})); } set(k, v) { this.h.set(k, v); } get(k) { return this.h.get(k) ?? null; } },
    ...globals,
    require: (m) => (stubs[m] || (m.startsWith('./') && ['diary-errors'].includes(m.slice(2)) ? load(m.slice(2)) : idle)),
  });
  return exports_;
}
const t = (key, p = {}) => `${key}|${JSON.stringify(p)}`;
const reply = (status, body, headers = {}) => ({ ok: false, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, clone() { return this; }, json: async () => body });
const month = async (res) => {
  const api = load('api', { fetch: async () => res });
  try { await api.fetchDiaryMonth('2026-10'); } catch (e) { return e; }
  assert.fail('it should have failed');
};

test('a throttled Diary read keeps its code and its wait, from the body', async () => {
  const e = await month(reply(503, { error: 'Storage is limiting sign-ins', code: 'storageThrottled', retryAfter: 42 }));
  assert.equal(e.code, 'storageThrottled');
  assert.equal(e.retryAfter, 42);
  const { diaryErrorText } = load('diary-errors');
  assert.match(diaryErrorText(t, e, 'en-GB'), /^storage\.throttledWait\|\{"wait":/, 'the page words the wait');
});

test('the Retry-After header is the wait when the body has none, and a bad value is no wait', async () => {
  assert.equal((await month(reply(503, { code: 'storageThrottled' }, { 'retry-after': '9' }))).retryAfter, 9);
  assert.equal((await month(reply(503, { code: 'storageThrottled', retryAfter: 5 }, { 'retry-after': '9' }))).retryAfter, 5, 'the body wins');
  for (const bad of ['soon', '-3', '0', '']) assert.equal((await month(reply(503, { code: 'storageThrottled' }, { 'retry-after': bad }))).retryAfter, undefined, bad);
  const plain = await month(reply(503, { error: 'Diary is unavailable right now. Try again shortly.', code: 'diaryUnavailable' }));
  assert.equal(plain.retryAfter, undefined);
  assert.equal(plain.code, 'diaryUnavailable');
});
