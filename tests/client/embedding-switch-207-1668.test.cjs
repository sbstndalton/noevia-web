'use strict';
// #1668 review: a 207 from switch/finish (the projects switched, the Diary did not) is not a full
// success. Synthetic replies only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(replies) {
  const sent = [];
  const apiFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body.action);
    const [status, json] = replies[body.action] || [200, { projects: { ok: true }, diary: { ok: true } }];
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/components/models/assignments.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ apiFetch }), Error, JSON });
  return { m: exports, sent };
}

const notReady = [207, { projects: { ok: true }, diary: { error: 'The new model has not finished indexing every Diary file yet.', code: 'notReady', status: 409 } }];
const refused = [207, { projects: { ok: true }, diary: { error: 'The Diary answered HTTP 500.', status: 500 } }];

test('Diary still re-indexing on switch: the outcome is diaryPending, not done', async () => {
  const { m, sent } = load({ switch: notReady });
  assert.equal(await m.serviceSwitchEmbedding({ model: 'embed-b', profile: 'embed-b' }), 'diaryPending');
  assert.deepEqual(sent, ['service-switch', 'switch', 'finish']);
  assert.equal(await load({ switch: notReady }).m.finishEmbeddingSwitch(), 'diaryPending');
  assert.equal(await load({ switch: notReady }).m.switchEmbedding({ model: 'embed-b', profile: 'embed-b' }, null), 'diaryPending');
});

test('Diary refusing a step: the outcome is diaryFailed', async () => {
  assert.equal(await load({ finish: refused }).m.serviceSwitchEmbedding({ model: 'embed-b', profile: 'embed-b' }), 'diaryFailed');
  assert.equal(await load({ switch: refused }).m.finishEmbeddingSwitch(), 'diaryFailed');
});

test('both halves fine, or no Diary configured: done', async () => {
  assert.equal(await load({}).m.serviceSwitchEmbedding({ model: 'embed-b', profile: 'embed-b' }), 'done');
  const none = [207, { projects: { ok: true }, diary: { error: 'The Diary sidecar is not configured.', code: 'notConfigured' } }];
  assert.equal(await load({ switch: none, finish: none }).m.finishEmbeddingSwitch(), 'done');
});

test('every locale has the Diary pending and failed messages', () => {
  const dir = path.join(__dirname, '../../src/i18n/models');
  const locales = ['de-DE', 'en-GB', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE'].map((l) => `${l}.ts`);
  assert.equal(locales.length, 9);
  for (const f of locales) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const key of ['mm.assign.diaryPending', 'mm.assign.diaryFailed']) {
      const line = text.split('\n').find((l) => l.includes(`'${key}'`));
      assert.ok(line && line.includes('{model}'), `${f} ${key}`);
    }
  }
});
