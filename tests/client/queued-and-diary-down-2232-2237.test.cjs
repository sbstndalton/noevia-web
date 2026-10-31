'use strict';
// #2237: a document whose reading service was away is `queued` (one state), worded as waiting, never as
// "Not readable · fetch failed". #2232: a Diary that is down answers 503 `diaryUnavailable`, which the page
// words itself instead of showing "Internal error".
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, Intl, Number, Object, Error, String, Set, require: (m) => load(path.posix.join(path.posix.dirname(file), m).replace(/^\.\//, '')) });
  return exports_;
}
const { sourceStatus, isUnreadableSource, uploadUnreadableReason, uploadWaitingReason } = load('source-status');
const { diaryErrorText } = load('diary-errors');
const t = (key, p = {}) => `${key}|${JSON.stringify(p)}`;

const queued = { name: 'a.pdf', content: '', document: { state: 'queued', extraction: 'queued', error: 'Waiting for document reading to come back. The file is saved and will be read automatically.', errorId: 'extractionWaiting' } };

test('a queued document says it is waiting, in the interface language, and is not a failed read', () => {
  assert.equal(sourceStatus(queued, t), 'projects.view.reason.extractionWaiting|{}');
  assert.match(sourceStatus(queued), /^Waiting for document reading to come back/);
  assert.doesNotMatch(sourceStatus(queued), /Not readable|fetch failed/);
  assert.equal(isUnreadableSource(queued), false, 'it is listed with the sources, not under Not readable');
});

test('an upload that is queued is saved, not a failure', () => {
  const result = { document: queued.document, attachment: { state: 'queued', group: 'Documents' } };
  assert.equal(uploadUnreadableReason(result, t), '');
  assert.equal(uploadWaitingReason(result, t), 'projects.view.reason.extractionWaiting|{}');
  assert.equal(uploadWaitingReason({ document: { state: 'ready' } }, t), '');
  // A real failure is still one.
  assert.match(uploadUnreadableReason({ document: { state: 'failed', error: 'x' } }, t), /^projects.view.notReadable/);
});

test('the Diary being down is worded as down for now, and a send keeps its "nothing was saved"', () => {
  const read = Object.assign(new Error('Diary is unavailable right now. Try again shortly.'), { code: 'diaryUnavailable' });
  assert.equal(diaryErrorText(t, read, 'en-GB'), 'diary.errors.diaryDown|{}');
  const send = Object.assign(new Error('x'), { code: 'diaryUnavailable', saved: false });
  assert.equal(diaryErrorText(t, send, 'en-GB'), 'diary.errors.diaryUnavailable|{}');
  assert.equal(diaryErrorText(t, new Error('Internal error'), 'en-GB'), 'Internal error');
});

test('the new sentences exist in every catalogue', () => {
  const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');
  for (const locale of LOCALES) {
    const c = catalogue(locale === 'en-US' ? 'en-GB' : locale);
    assert.ok(c['diary.errors.diaryDown'] && c['projects.view.reason.extractionWaiting'], locale);
  }
});

test('GET helpers keep the server code so the Diary page can word it', () => {
  const api = fs.readFileSync(path.join(SRC, 'api.ts'), 'utf8');
  const getJson = api.slice(api.indexOf('async function getJson'), api.indexOf('async function getJson') + 400);
  assert.match(getJson, /failureFromResponse\(res/);
});
