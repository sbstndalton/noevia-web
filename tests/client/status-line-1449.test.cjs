'use strict';
// #1449: the loading-model status names the model and its routed role, and gives the expected wait
// only when the server measured one. Loads the real catalogues and chat-labels from source, like
// locale-640-645.test.cjs. Synthetic model names only.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, Error, console, Promise, TextEncoder,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const core = load('i18n/core');
const FILES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(FILES)) core.registerCatalogue(locale, load(`i18n/${locale}`)[name]);
const LOCALES = ['en-GB', ...Object.keys(FILES)];
const tFor = (locale) => (key, params) => core.translate(locale, key, params);
const labels = load('chat-labels');
const MODEL = 'Synthetic-Model-7B-Q4';

test('#1449 the loading line names the model and the routed role, with the measured wait', () => {
  const t = tFor('en-GB');
  assert.equal(labels.statusLineText(t, 'loadingModel', 'server text', { model: MODEL, role: 'smart', expectedSeconds: 12 }),
    `Loading ${MODEL} (Smart) and checking its context allocation… Expected wait about 12 s.`);
});

test('#1449 no measured wait means no number; no role means the model alone', () => {
  const t = tFor('en-GB');
  assert.equal(labels.statusLineText(t, 'loadingModel', 'x', { model: MODEL }), `Loading ${MODEL} and checking its context allocation…`);
  assert.doesNotMatch(labels.statusLineText(t, 'loadingModel', 'x', { model: MODEL, role: 'fast' }), /wait/i);
});

test('#1449 an unknown role id stays as the server sent it; an id without detail keeps the catalogue line', () => {
  const t = tFor('en-GB');
  assert.match(labels.statusLineText(t, 'loadingModel', 'x', { model: MODEL, role: 'vision' }), /\(vision\)/);
  assert.equal(labels.statusLineText(t, 'loadingModel', 'English fallback'), 'Loading the selected model and checking its context allocation…');
  assert.equal(labels.statusLineText(t, 'generating', 'x', { model: MODEL }), 'Generating response…', 'only loadingModel is named');
  assert.equal(labels.statusLineText(t, 'not-a-known-id', 'Server English'), 'Server English', 'an unknown id keeps the server text');
});

test('#1449 every locale names the model and has no unfilled placeholder', () => {
  for (const locale of LOCALES) {
    const t = tFor(locale);
    for (const detail of [{ model: MODEL, role: 'fast', expectedSeconds: 7 }, { model: MODEL }]) {
      const shown = labels.statusLineText(t, 'loadingModel', 'x', detail);
      assert.ok(shown.includes(MODEL), `${locale}: "${shown}" names the model`);
      assert.doesNotMatch(shown, /\{\w+\}/, `${locale}: no placeholder left`);
      assert.notEqual(shown, 'x', `${locale}: not the server text`);
    }
  }
});

test('#1449 statusDetail keeps only well-formed fields from the server event', () => {
  // The vm realm has its own Object prototype, so compare as JSON rather than with deepEqual.
  const json = (v) => JSON.stringify(v ?? null);
  assert.equal(json(labels.statusDetail({ model: ` ${MODEL} `, role: 'code', expectedSeconds: 9.4 })), json({ model: MODEL, role: 'code', expectedSeconds: 9 }));
  assert.equal(json(labels.statusDetail({ model: MODEL, expectedSeconds: 0 })), json({ model: MODEL }));
  assert.equal(labels.statusDetail({ model: 42, expectedSeconds: 'soon' }), undefined);
  assert.equal(labels.statusDetail(undefined), undefined);
  assert.equal(labels.statusDetail('Synthetic-Model-7B-Q4'), undefined);
  assert.equal(labels.statusDetail({ expectedSeconds: NaN }), undefined);
});

test('#1449 the web reads the detail the core sends and the chat view passes it on', () => {
  const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  assert.match(app, /processingStatusDetail: statusDetail\(ev\.detail\)/);
  const view = fs.readFileSync(path.join(SRC, 'components/ChatView.tsx'), 'utf8');
  assert.match(view, /statusLineText\(t, m\.processingStatusId, m\.processingStatus, m\.processingStatusDetail\)/);
});
