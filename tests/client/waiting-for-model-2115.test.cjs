'use strict';
// sbstndalton/noevia#2115, #2117: while another chat's model is in use, a turn waits in the local model's queue (the
// inference gate). The reply's status line says so, with the model, its role, the place in the queue and the wait so
// far, in every interface language. A refusal from the queue reads as a plain sentence that says to try again.
// Loads the real catalogues, chat-labels and failure-copy from source, like status-line-1449.test.cjs. Synthetic names.
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
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, Error, TypeError, console, Promise, TextEncoder,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const core = load('i18n/core');
const FILES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(FILES)) core.registerCatalogue(locale, load(`i18n/${locale}`)[name]);
const LOCALES = ['en-GB', ...Object.keys(FILES)];
const tFor = (locale) => (key, params) => core.translate(locale, key, params);
const labels = load('chat-labels');
const { failureCopy } = load('failure-copy');
const MODEL = 'Synthetic-Route-Smart-Q4';

test('noevia#2115 the waiting line names the model, its role, the place in the queue and the wait so far', () => {
  const t = tFor('en-GB');
  const detail = labels.statusDetail({ model: MODEL, role: 'smart', position: 2, waitedSeconds: 14 });
  assert.deepEqual({ ...detail }, { model: MODEL, role: 'smart', position: 2, waitedSeconds: 14 });
  assert.equal(labels.statusLineText(t, 'waitingForModel', 'server English', detail),
    `Waiting for another chat to finish before ${MODEL} (Smart) can answer (place 2 in the queue)… Waited 14 s so far.`);
  assert.equal(labels.statusLineText(t, 'waitingForModel', 'x', labels.statusDetail({ model: MODEL, position: 1, waitedSeconds: 0 })),
    `Waiting for another chat to finish before ${MODEL} can answer (place 1 in the queue)…`, 'no role, nothing waited yet');
  assert.equal(labels.statusLineText(t, 'waitingForModel', 'x'), 'Waiting for another chat to finish with the local model…', 'no detail');
});

test('noevia#2115 the detail is checked field by field', () => {
  const d = labels.statusDetail({ model: MODEL, position: 0, waitedSeconds: -3 });
  assert.equal(d.position, undefined); assert.equal(d.waitedSeconds, undefined);
  assert.equal(labels.statusDetail({ model: MODEL, position: 2.5 }).position, undefined);
  assert.equal(labels.statusDetail({ model: MODEL, waitedSeconds: Infinity }).waitedSeconds, undefined);
  assert.equal(labels.statusDetail({ position: 3 }).position, 3, 'a place in the queue alone is a detail');
  // The detail is shown on the line only with a model; otherwise the catalogue line stands.
  assert.equal(labels.statusLineText(tFor('en-GB'), 'waitingForModel', 'x', { position: 3 }), 'Waiting for another chat to finish with the local model…');
});

test('noevia#2115 every locale words the waiting line with no unfilled placeholder', () => {
  for (const locale of LOCALES) {
    const t = tFor(locale);
    for (const detail of [{ model: MODEL, role: 'code', position: 3, waitedSeconds: 9 }, { model: MODEL, position: 1 }, undefined]) {
      const shown = labels.statusLineText(t, 'waitingForModel', 'x', detail);
      if (detail) assert.ok(shown.includes(MODEL), `${locale}: "${shown}" names the model`);
      if (detail?.waitedSeconds) assert.ok(shown.includes('9'), `${locale}: "${shown}" gives the wait`);
      if (detail) assert.ok(shown.includes(String(detail.position)), `${locale}: "${shown}" gives the place`);
      assert.doesNotMatch(shown, /\{\w+\}/, `${locale}: no placeholder left`);
      assert.notEqual(shown, 'x', `${locale}: not the server text`);
    }
  }
});

test('noevia#2115 a refusal from the local model\'s queue reads as a plain sentence in every locale', () => {
  const codes = ['inference_queue_timeout', 'inference_queue_full', 'engine_switch_stuck', 'engine_unavailable', 'engine_busy', 'gate_busy'];
  const en = tFor('en-GB');
  const err = (code) => Object.assign(new Error('Server English text'), { code });
  assert.equal(failureCopy(err('inference_queue_timeout'), en), 'Another chat was still using the local model, so this reply did not start. Try again when it has finished.');
  assert.equal(failureCopy(err('inference_queue_full'), en), 'Too many chats are waiting for the local model. Try again shortly.');
  assert.equal(failureCopy(err('engine_switch_stuck'), en), 'The local model engine is still releasing the previous model. Try again shortly.');
  for (const locale of LOCALES) {
    const t = tFor(locale);
    for (const code of codes) {
      const shown = failureCopy(err(code), t);
      assert.notEqual(shown, 'Server English text', `${locale}/${code} is worded here`);
      assert.ok(shown.length > 20, `${locale}/${code}`);
    }
  }
  // Any other code keeps the server's text, as before.
  assert.equal(failureCopy(err('inferenceMaintenance'), en), 'Server English text');
  assert.equal(failureCopy(err('toString'), en), 'Server English text', 'not a prototype key');
});
