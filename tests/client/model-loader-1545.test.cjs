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

test('the panel renders loaderLines, and the stylesheet keeps each line unbroken', () => {
  const tsx = fs.readFileSync(path.join(__dirname, '../../src/components/models/OverviewTab.tsx'), 'utf8');
  assert.match(tsx, /loaderLines\(t, backends, unhealthy, \(probeError\) => describeBackendError\(t, probeError\)\)/);
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles/noevia.css'), 'utf8');
  assert.match(css, /\.mm-loader-item \{[^}]*white-space: nowrap;[^}]*\}/);
  assert.match(css, /\.mm-loader-state \{[^}]*flex: 1 1 100%;[^}]*\}/, 'the engine lines take the full row');
});
