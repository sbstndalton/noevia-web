'use strict';
// sbstndalton/noevia#2115 review: the "waiting for the local model" and "loading the model" status lines describe a wait.
// The server sends no further status once the model is granted or loaded, so the line must end when the answer starts,
// not stay beside the streamed text until done. Runs the real reply-status and chat-labels from source and plays a
// stream with a pause between the first text and done, like the real thing. Synthetic names.
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
const { statusStep, clearTransientStatus } = load('reply-status');
const labels = load('chat-labels');
const t = (key, params) => core.translate('en-GB', key, params);
const MODEL = 'Synthetic-Route-Smart-Q4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAITING = { type: 'status', id: 'waitingForModel', text: 'Server English: waiting.', detail: { model: MODEL, role: 'smart', position: 1, waitedSeconds: 4 } };
const LOADING = { type: 'status', id: 'loadingModel', text: 'Server English: loading.', detail: { model: MODEL, expectedSeconds: 20 } };

/** The reply the way App keeps it, and the line ChatView draws while it streams. */
function reply() { return { id: 'r1', content: '', processingStatus: undefined, processingStatusId: undefined, processingStatusDetail: undefined }; }
const lineShown = (m) => labels.statusLineText(t, m.processingStatusId, m.processingStatus, m.processingStatusDetail) || t('chat.status.generating');
function feed(m, state, ev) {
  const step = statusStep(ev, state.shown);
  state.shown = step.transientShown;
  if (step.patch) Object.assign(m, step.patch);
  if (ev.type === 'delta') m.content += ev.text;
}
/** A stream with a real pause before done; `observe` sees the reply during the pause, while it still streams. */
async function play(events, observe) {
  const m = reply(), state = { shown: false };
  for (const ev of events) {
    if (ev.type === 'done') { await sleep(40); observe(m); }
    feed(m, state, ev);
  }
  return m;
}

for (const [name, first, shownLine] of [['waitingForModel', WAITING, /^Waiting for another chat to finish before/], ['loadingModel', LOADING, /^Loading /]]) {
  test(`noevia#2115 the ${name} line is gone once the first text arrives, before done`, async () => {
    const m = reply(), state = { shown: false };
    feed(m, state, first);
    assert.match(lineShown(m), shownLine, 'shown while it waits');
    feed(m, state, { type: 'delta', text: 'Synthetic answer' });
    await sleep(40); // the answer streams on; no further status comes
    assert.equal(m.processingStatusId, undefined);
    assert.equal(m.processingStatusDetail, undefined);
    assert.equal(lineShown(m), t('chat.status.generating'), 'the line no longer claims a wait while the answer streams');
    feed(m, state, { type: 'done' });
    assert.equal(m.content, 'Synthetic answer');
  });

  test(`noevia#2115 the ${name} line is gone when the context meter, thinking or a tool call shows the model is answering`, () => {
    for (const answering of [{ type: 'context', used: 10 }, { type: 'reasoning', text: 'hmm' }, { type: 'preamble', text: 'First,' }, { type: 'tool', name: 'search' }, { type: 'tool_pending' }]) {
      const m = reply(), state = { shown: false };
      feed(m, state, first);
      feed(m, state, answering);
      assert.equal(m.processingStatusId, undefined, answering.type);
    }
  });

  test(`noevia#2115 the ${name} line stays while only unrelated events arrive`, () => {
    const m = reply(), state = { shown: false };
    feed(m, state, first);
    for (const ev of [{ type: 'meta', model: MODEL }, { type: 'telemetry' }, { type: 'delta', text: '' }, { type: 'warning', text: 'x' }]) feed(m, state, ev);
    assert.equal(m.processingStatusId, name);
  });
}

test('noevia#2115 a waiting reply cleared by its first text, with a pause before done, never shows the line again', async () => {
  const seen = [];
  const m = await play([{ type: 'meta', model: MODEL }, WAITING, { type: 'delta', text: 'Synthetic answer after the wait.' }, { type: 'done' }], (during) => seen.push(lineShown(during)));
  assert.deepEqual(seen, [t('chat.status.generating')]);
  assert.equal(m.processingStatusId, undefined);
});

test('noevia#2115 only a wait line is ended by the answer; a wait that comes again shows again', () => {
  const m = reply(), state = { shown: false };
  feed(m, state, WAITING);
  feed(m, state, { type: 'delta', text: 'a' });
  feed(m, state, { type: 'status', id: 'searching', text: 'Searching…' });
  feed(m, state, { type: 'delta', text: 'b' });
  assert.equal(m.processingStatusId, 'searching', 'another status is the server\'s to replace');
  feed(m, state, WAITING); // a later tool round queues again
  assert.equal(m.processingStatusId, 'waitingForModel');
  feed(m, state, { type: 'context' });
  assert.equal(m.processingStatusId, undefined);
});

test('noevia#2115 a reply that ends (done, failed or stopped) while still waiting drops the wait line', () => {
  const waiting = { id: 'r', processingStatus: 'x', processingStatusId: 'waitingForModel', processingStatusDetail: { model: MODEL } };
  const settled = clearTransientStatus(waiting);
  assert.equal(settled.processingStatusId, undefined);
  assert.equal(settled.processingStatus, undefined);
  assert.equal(settled.processingStatusDetail, undefined);
  assert.equal(settled.id, 'r');
  const other = { id: 'r', processingStatusId: 'searching', processingStatus: 'Searching…' };
  assert.equal(clearTransientStatus(other), other, 'anything else is returned as it was');
});

test('noevia#2115 a waiting detail with no place in the queue is worded without a place', () => {
  const noPlace = labels.statusDetail({ model: MODEL, role: 'smart', waitedSeconds: 6 });
  assert.equal(noPlace.position, undefined);
  assert.equal(labels.statusLineText(t, 'waitingForModel', 'x', noPlace), `Waiting for another chat to finish before ${MODEL} (Smart) can answer… Waited 6 s so far.`);
  assert.equal(labels.statusLineText(t, 'waitingForModel', 'x', { model: MODEL }), `Waiting for another chat to finish before ${MODEL} can answer…`);
});

test('noevia#2115 every locale words a wait with no place in the queue without a place and with no placeholder left', () => {
  for (const locale of LOCALES) {
    const tt = tFor(locale);
    for (const detail of [{ model: MODEL, role: 'code', waitedSeconds: 9 }, { model: MODEL }]) {
      const shown = labels.statusLineText(tt, 'waitingForModel', 'x', detail);
      assert.ok(shown.includes(MODEL), `${locale}: names the model`);
      assert.doesNotMatch(shown, /\{\w+\}/, `${locale}: no placeholder left`);
      assert.notEqual(shown, labels.statusLineText(tt, 'waitingForModel', 'x', { ...detail, position: 1 }), `${locale}: differs from the line with a place`);
      assert.ok(!/1/.test(shown.replace(MODEL, '')), `${locale}: no invented place in "${shown}"`);
    }
  }
});

test('noevia#2115 the chat view announces a wait once, politely, from a region whose text does not change with the tick', () => {
  const view = fs.readFileSync(path.join(SRC, 'components/ChatView.tsx'), 'utf8');
  const region = view.match(/<span className="sr-only" role="status" aria-live="polite"[^>]*>\{m\.processingStatusId === 'waitingForModel'[^}]*\}<\/span>/);
  assert.ok(region, 'a polite status region for the waiting state');
  assert.doesNotMatch(region[0], /processingStatusDetail|waitedSeconds|autoFocus|focus\(/, 'the announcement does not change with the wait or take focus');
  assert.match(view, /<div className="msg-meta" aria-live="off">/, 'the ticking line stays silent');
  // The announced words are the same on every update, whatever the place or the seconds waited.
  const t = tFor('en-GB');
  assert.equal(t('chat.statusId.waitingForModel'), 'Waiting for another chat to finish with the local model…');
});
