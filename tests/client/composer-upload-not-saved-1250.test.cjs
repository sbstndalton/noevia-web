'use strict';
// #1250: the chat composer said "Saved 0/1. <file>: Storage login rejected…" for an upload the server
// never stored. Leading with "Saved" for a file that was not kept contradicts the Sources result in the
// same session. When nothing was saved the line leads with "Not saved"; a partial batch keeps "Saved N/M".
// Runs the real uploadAttachments with fakes for its imports, as account-preferences-905 does.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const src = (name) => path.join(__dirname, '../../src', name);
function load(name, requireMap) {
  const exports_ = {};
  const code = ts.transpileModule(fs.readFileSync(src(name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exports_, require: (id) => { if (!(id in requireMap)) throw Error(`unexpected require ${id}`); return requireMap[id]; }, JSON, Date, Object, Error, Promise, Math });
  return exports_;
}
const t = Object.assign((key, params) => (params ? `${key} ${JSON.stringify(params)}` : key), { plural: (key, n) => `${key}:${n}`, locale: 'en-GB' });

function actionsWith(uploadProjectFile) {
  return load('components/ComposerActions.tsx', {
    react: { useEffect() {}, useId() {}, useRef() {}, useState() {} },
    'react/jsx-runtime': { jsx() {}, jsxs() {}, Fragment: {} },
    '../api': { fetchToolboxes() {}, saveProjectConfig() {}, uploadProjectFile },
    '../sources': { fileToBase64: async () => 'AA==', uploadLimit: () => 1e9 },
    '../project-files': load('project-files.ts', {}),
    '../user-preferences': { appLocale: () => undefined },
    './ShellIcon': { ShellIcon() {} },
    '../source-status': { uploadFailureText: (err, _t, fallback) => err?.message || fallback, uploadWaitingReason: () => '', uploadUnreadableReason: () => '' },
    '../number-format': { formatPercent: () => '' },
    '../i18n': { useT: () => t },
    '../toolbox-copy': { toolboxCopy() {} },
    '../tools-mode': { toolsModeOf: () => 'manual' },
    './SegmentedControl': { SegmentedControl() {} },
  });
}
const sink = (statuses) => ({ project: { id: 'p1', name: 'Synthetic', files: [] }, disabled: false, chatOnly: true, onChanged: async () => {}, onBusy: () => {}, onStatus: (s) => statuses.push(s) });

test('when storage rejects every file, the line leads with "Not saved", not "Saved 0/1"', async () => {
  const actions = actionsWith(async () => { throw Error('Storage login rejected (synthetic)'); });
  const statuses = [];
  await actions.uploadAttachments(sink(statuses), [{ name: 'a.txt', size: 3 }], t);
  const last = statuses.at(-1);
  assert.match(last, /^composer\.upload\.notSaved /, last);
  assert.doesNotMatch(last, /composer\.upload\.partial/);
  assert.match(last, /a\.txt: Storage login rejected \(synthetic\)/);
});

test('a batch where some files were kept still reads "Saved N/M" with the failures named', async () => {
  let call = 0;
  const actions = actionsWith(async () => { if (++call === 2) throw Error('Storage login rejected (synthetic)'); return {}; });
  const statuses = [];
  await actions.uploadAttachments(sink(statuses), [{ name: 'a.txt', size: 3 }, { name: 'b.txt', size: 3 }], t);
  const last = statuses.at(-1);
  assert.match(last, /^composer\.upload\.partial /, last);
  assert.match(last, /"saved":1,"total":2/);
});

test('a clean batch keeps the saved line', async () => {
  const actions = actionsWith(async () => ({}));
  const statuses = [];
  await actions.uploadAttachments(sink(statuses), [{ name: 'a.txt', size: 3 }], t);
  assert.match(statuses.at(-1), /^composer\.upload\.saved:1/);
});
