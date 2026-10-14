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
  assert.match(tsx, /loaderLines\(t, backends, unhealthy, \(probeError\) => describeBackendError\(t, probeError\)\)/);
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

test('the engine row and the job list settle on their own reads, not on one shared wait', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/models/OverviewTab.tsx'), 'utf8');
  const load = src.slice(src.indexOf('const load = useCallback'), src.indexOf('useEffect(() => { void load(); }, [load]);'));
  assert.match(load, /bounded\(mm<\{ backends: Backend\[\] \}>\('backends'\)[^;]*setBackends\(v\)/s);
  assert.doesNotMatch(load, /const \[autotune, calibration, downloads, engines, installed\]/);
});

test('the row is named in plain words in every locale, not after the internal model loader', () => {
  for (const [locale, cat] of Object.entries(MODELS)) {
    for (const key of ['mm.recover.loader', 'mm.recover.checkingLoader', 'mm.recover.healthUnavailableHelp']) {
      assert.doesNotMatch(cat[key] || '', /loader|cargador|chargeur|caricatore|lader|laster|inläsare/i, `${locale} ${key}: ${cat[key]}`);
    }
  }
  assert.equal(MODELS['en-GB']['mm.recover.loader'], 'Engines');
});
