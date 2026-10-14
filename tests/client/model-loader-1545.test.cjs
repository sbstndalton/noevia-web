'use strict';
// #1545: Models > Performance > Recover showed the model loader as one run-on sentence, broken inside
// model names, and named engines by their internal service names (cowork-llama-1). The lines now come
// from loaderLines (one per engine, "Engine 1", "Engine 2"), the names inside them are never split,
// and the CSS keeps each line unbroken.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODELS_LOCALES, catalogues, load } = require('./settings-catalogue-b4.cjs');

const MODELS = catalogues(MODELS_LOCALES);
const EN = MODELS['en-GB'];
const { loaderLines } = load('components/models/loader-lines');

// A stand-in translator over the real English strings: fills {placeholders} from params.
const t = (key, params = {}) => {
  const text = EN[key];
  assert.ok(text, `English has ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
};
const describe = (probeError) => `described: ${probeError}`;
const { knownBackendError } = load('components/models/backend-errors');
const tAny = (key, params = {}) => (EN[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
const known = (probeError) => knownBackendError(tAny, probeError);

const healthy = [
  { name: 'cowork-llama-1', status: 'running', loaded_model: 'gemma-4-12b-it-qat-q4_0', probe_error: null, last_restart_error: null },
  { name: 'cowork-embed-1', status: 'running', loaded_model: 'nomic-embed-text-v1', probe_error: null, last_restart_error: null },
];

test('each engine gets its own line, named by place, with its model name whole', () => {
  const lines = loaderLines(t, healthy, [], describe).map((line) => line.text);
  assert.deepEqual(lines, [
    'Engine 1 running · gemma-4-12b-it-qat-q4_0 loaded',
    'Engine 2 running · nomic-embed-text-v1 loaded',
  ]);
});

test('no internal service name reaches the page, healthy or unhealthy', () => {
  const sick = [{ ...healthy[1], status: 'exited', probe_error: 'connection refused' }];
  for (const backends of [healthy, sick]) {
    const text = loaderLines(t, backends, backends === healthy ? [] : sick, describe).map((line) => line.text).join('\n');
    assert.ok(!/cowork-/.test(text), `no service name in: ${text}`);
  }
});

test('an unhealthy engine is listed on its own line with its numbered label and the described problem', () => {
  const backends = [healthy[0], { ...healthy[1], probe_error: 'timeout' }];
  const lines = loaderLines(t, backends, [backends[1]], describe);
  assert.deepEqual(lines.map((line) => line.text), ['Engine 2: described: timeout']);
});

test('raw service text never reaches the row: a restart error, an unknown probe error, a status word', () => {
  const sick = [
    { ...healthy[0], status: 'running', last_restart_error: 'No such container: cowork-embed-1' },
    { ...healthy[1], status: 'running', probe_error: 'docker.errors.APIError: 500 cowork-embed-1 sampler blew up' },
    { ...healthy[1], name: 'cowork-ocr-1', status: 'exited' },
    { ...healthy[1], name: 'cowork-x-1', status: 'weird-state' },
  ];
  const lines = loaderLines(t, sick, sick, known).map((line) => line.text);
  assert.deepEqual(lines, [
    'Engine 1: restart failed',
    'Engine 2: not answering normally',
    'Engine 3: the container has stopped',
    'Engine 4: not running',
  ]);
  const text = lines.join('\n');
  for (const raw of ['cowork-', 'No such container', 'APIError', 'exited', 'weird-state']) assert.ok(!text.includes(raw), `${raw} hidden in: ${text}`);
  // A known probe error is still described in the interface language.
  const slow = { ...healthy[0], probe_error: 'timeout' };
  assert.deepEqual(loaderLines(t, [slow], [slow], known).map((l) => l.text), [`Engine 1: ${EN['mm.hw.err.timeout']}`]);
});

test('the new engine problem words are translated in every locale', () => {
  for (const [locale, catalogue] of Object.entries(MODELS)) {
    for (const key of ['mm.recover.restartFailed', 'mm.recover.notRunning', 'mm.recover.engineProblem']) {
      assert.ok(catalogue[key], `${locale} has ${key}`);
      if (locale !== 'en-GB' && locale !== 'en-US') assert.notEqual(catalogue[key], EN[key], `${locale} ${key} is translated`);
    }
  }
});

test('a loaded model name is never split across lines (one string per engine)', () => {
  const lines = loaderLines(t, healthy, [], describe);
  assert.equal(lines.length, 2);
  for (const model of ['gemma-4-12b-it-qat-q4_0', 'nomic-embed-text-v1']) {
    assert.equal(lines.filter((line) => line.text.includes(model)).length, 1, `${model} sits whole on one line`);
  }
});

test('every locale has a numbered engine label with its placeholder, translated', () => {
  for (const [locale, catalogue] of Object.entries(MODELS)) {
    const text = catalogue['mm.recover.engineIndex'];
    assert.match(text, /\{index\}/, `${locale} takes the number`);
    if (locale !== 'en-GB') assert.notEqual(text, EN['mm.recover.engineIndex'], `${locale} is translated`);
  }
});

test('the panel renders loaderLines, and the stylesheet never breaks inside a model name', () => {
  const tsx = fs.readFileSync(path.join(__dirname, '../../src/components/models/OverviewTab.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');
  assert.match(tsx, /<span className="mm-loader-model">\{model\}<\/span>/, 'the model name is its own unit');
  assert.match(css, /\.mm-loader-model \{[^}]*white-space: nowrap;[^}]*\}/);
  assert.equal(loaderLines(t, healthy, [], describe)[0].model, 'gemma-4-12b-it-qat-q4_0');
  assert.match(css, /\.mm-loader-state \{[^}]*flex: 1 1 100%;[^}]*\}/, 'the engine lines take the full row');
});

// #1545 (live, ab1445b0): the row kept its internal "Model loader" name and could stay on "Checking…"
// for good, because the panel waited for five reads together with no time limit.
test('every read is bounded: a read that never answers gives the fallback, a fast one its own value', async () => {
  const { within, RECOVER_READ_TIMEOUT_MS } = load('components/models/loader-lines');
  assert.ok(RECOVER_READ_TIMEOUT_MS > 0 && RECOVER_READ_TIMEOUT_MS <= 15000, `${RECOVER_READ_TIMEOUT_MS} ms`);
  assert.equal(await within(new Promise(() => {}), 20, 'unavailable'), 'unavailable');
  assert.equal(await within(Promise.resolve('ok'), 1000, 'unavailable'), 'ok');
  assert.equal(await within(Promise.reject(new Error('down')), 1000, null), null);
});

test('a superseded or stopped check is not current and its requests are aborted', () => {
  const { recoverRuns } = load('components/models/loader-lines');
  const runs = recoverRuns();
  const first = runs.start();
  assert.ok(first.isCurrent());
  const second = runs.start();
  assert.equal(first.signal.aborted, true, 'the older run is aborted when a newer one starts');
  assert.equal(first.isCurrent(), false, 'the older run may no longer write its results');
  assert.ok(second.isCurrent());
  second.abort();
  assert.equal(second.signal.aborted, true, 'a run that hit its time limit aborts its hanging requests');
  assert.equal(second.isCurrent(), true, 'and still writes its "unavailable" fallbacks, being the newest');
  const third = runs.start();
  runs.stop();
  assert.equal(third.signal.aborted, true, 'leaving the panel aborts the running check');
  assert.equal(third.isCurrent(), false);
});

test('a bounded read that gives up calls onTimeout (so the caller can abort it); one that answers does not', async () => {
  const { within } = load('components/models/loader-lines');
  let aborted = 0;
  assert.equal(await within(new Promise(() => {}), 10, null, () => { aborted++; }), null);
  assert.equal(aborted, 1);
  assert.equal(await within(Promise.resolve('ok'), 1000, null, () => { aborted++; }), 'ok');
  assert.equal(aborted, 1);
});

test('the row is named in plain words in every locale, not after the internal model loader', () => {
  for (const [locale, cat] of Object.entries(MODELS)) {
    for (const key of ['mm.recover.loader', 'mm.recover.checkingLoader', 'mm.recover.healthUnavailableHelp']) {
      assert.doesNotMatch(cat[key] || '', /loader|cargador|chargeur|caricatore|lader|laster|inläsare/i, `${locale} ${key}: ${cat[key]}`);
    }
  }
  assert.equal(MODELS['en-GB']['mm.recover.loader'], 'Engines');
});
