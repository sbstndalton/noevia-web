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

test('a write that timed out says the change may not have been saved, never "try again" or "nothing was saved"', () => {
  const write = Object.assign(new Error('x'), { code: 'diaryUnavailable', write: true });
  assert.equal(diaryErrorText(t, write, 'en-GB'), 'diary.errors.diaryDownWrite|{}');
  const { EN_GB_DIARY } = load('i18n/diary/en-GB');
  assert.match(EN_GB_DIARY['diary.errors.diaryDownWrite'], /may not have been saved/);
  assert.doesNotMatch(EN_GB_DIARY['diary.errors.diaryDownWrite'], /Nothing was saved|Try again shortly/);
  assert.doesNotMatch(EN_GB_DIARY['diary.errors.diaryDown'], /saved/i, 'a read or listing has no save wording');
  // The request error marks a PUT and a non-read POST as writes, and a listing or file read as reads.
  const src = fs.readFileSync(path.join(SRC, 'diary-workspace.ts'), 'utf8');
  assert.match(src, /method === 'PUT' \|\| \(method === 'POST' && path !== 'file'\)/);
});

test('streamChat keeps the code of a refused Diary exchange so it is worded as a write', () => {
  const api = fs.readFileSync(path.join(SRC, 'api.ts'), 'utf8');
  assert.match(api, /Object\.assign\(new Error\(message\), \{ code, write: !!body\.files \}\)/);
});

test('a queued record that still has earlier text says so first; the composer tells the person', () => {
  const stale = { name: 'a.pdf', content: 'earlier', document: { ...queued.document, stale: true } };
  assert.match(sourceStatus(stale), /^Using previous text · Waiting for document reading/);
  assert.match(fs.readFileSync(path.join(SRC, 'components/ComposerActions.tsx'), 'utf8'), /uploadWaitingReason\(result, t\)[\s\S]{0,80}notices\.push/);
  assert.match(fs.readFileSync(path.join(SRC, 'components/data/RetentionSetting.tsx'), 'utf8'), /if \(!r\.ok\) \{ notifyWorkspaceChanged\(\)/);
});

test('the new sentences exist in every catalogue', () => {
  const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');
  for (const locale of LOCALES) {
    const c = catalogue(locale === 'en-US' ? 'en-GB' : locale);
    assert.ok(c['diary.errors.diaryDown'] && c['diary.errors.diaryDownWrite'] && c['projects.view.reason.extractionWaiting'], locale);
  }
});

test('GET helpers keep the server code so the Diary page can word it', () => {
  const api = fs.readFileSync(path.join(SRC, 'api.ts'), 'utf8');
  const getJson = api.slice(api.indexOf('async function getJson'), api.indexOf('async function getJson') + 400);
  assert.match(getJson, /failureFromResponse\(res/);
});

// Runs the real uploadAttachments (composer) with fakes for its imports, as attachment-chip-stored-name does.
test('a queued document attached from the composer gets a waiting notice, and a ready one none (#2237)', async () => {
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, 'components/ComposerActions.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const real = load('source-status');
  const fakes = {
    react: { useEffect() {}, useId() {}, useRef() {}, useState() {} }, 'react/jsx-runtime': { jsx() {}, jsxs() {}, Fragment: {} },
    '../api': { fetchToolboxes() {}, saveProjectConfig() {}, uploadProjectFile: async (_id, body) => (body.name.startsWith('q') ? { document: queued.document, attachment: { state: 'queued', group: 'Documents' } } : { document: { state: 'ready' }, attachment: { state: 'ready', group: 'Documents' } }) },
    '../sources': { fileToBase64: async () => 'AA==', uploadLimit: () => 1e9 }, '../project-files': load('project-files'),
    '../user-preferences': { appLocale: () => undefined }, './ShellIcon': { ShellIcon() {} }, '../source-status': real,
    '../number-format': { formatPercent: () => '' }, '../i18n': { useT: () => t }, '../toolbox-copy': { toolboxCopy() {} },
    '../tools-mode': { toolsModeOf: () => 'manual' }, './SegmentedControl': { SegmentedControl() {} },
  };
  const exports_ = {};
  vm.runInNewContext(code, { exports: exports_, require: (id) => { if (!(id in fakes)) throw Error(`unexpected require ${id}`); return fakes[id]; }, JSON, Date, Object, Error, Promise, Math });
  const run = async (name) => {
    const statuses = [];
    const tt = Object.assign((key, params) => (params ? `${key} ${JSON.stringify(params)}` : key), { plural: (key, n) => `${key}:${n}`, locale: 'en-GB' });
    await exports_.uploadAttachments({ project: { id: 'p1', name: 'P', files: [] }, disabled: false, chatOnly: true, onChanged: async () => {}, onBusy: () => {}, onStatus: (s) => statuses.push(s), onSaved: () => {} }, [{ name, size: 3 }], tt);
    return statuses.join('\n');
  };
  assert.match(await run('q.pdf'), /projects\.view\.reason\.extractionWaiting/);
  assert.doesNotMatch(await run('ok.pdf'), /extractionWaiting/);
});
