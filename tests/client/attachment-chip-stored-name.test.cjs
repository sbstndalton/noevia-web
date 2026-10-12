'use strict';
// A file whose name the project already has is saved as a numbered copy (#1454, 'report (2).pdf'). The chip
// (#1514) used to show the name the person picked ('report.pdf'), while the stored copy is what the model is
// given, so the chip named a different file. Runs the real uploadAttachments with fakes for its imports.
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
    '../source-status': { uploadFailureText: (err, _t, fallback) => err?.message || fallback, uploadUnreadableReason: () => '' },
    '../number-format': { formatPercent: () => '' },
    '../i18n': { useT: () => t },
    '../toolbox-copy': { toolboxCopy() {} },
    '../tools-mode': { toolsModeOf: () => 'manual' },
    './SegmentedControl': { SegmentedControl() {} },
  });
}

test('the chip names the stored copy when the name was taken, and the plain name otherwise', async () => {
  const stored = [];
  const actions = actionsWith(async (_id, body) => { stored.push(body.name); return {}; });
  const reported = [];
  const sink = { project: { id: 'p1', name: 'Synthetic', files: [{ name: 'report.pdf' }] }, disabled: false, chatOnly: true,
    onChanged: async () => {}, onBusy: () => {}, onStatus: () => {}, onSaved: (names) => reported.push(...names) };
  await actions.uploadAttachments(sink, [{ name: 'report.pdf', size: 3 }, { name: 'notes.txt', size: 3 }], t);
  assert.deepEqual(stored, ['report (2).pdf', 'notes.txt'], 'the project keeps a numbered copy');
  assert.deepEqual(reported, stored, 'the chips carry the stored names, the ones the model is given');
});
