'use strict';
// #1816: a saved llama.cpp reranker choice that is not among the offered choices is kept as the current value, so turning
// reranking off sends it back instead of null. Synthetic ids only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exports_ = {};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/components/models/assignments.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { exports: exports_, require: () => ({ apiFetch: async () => ({}) }), Error, JSON });
const { rerankerCurrent } = exports_;
const tei = { id: 'tei', backend: 'tei', model: 'synthetic-tei' };

test('a saved choice that is offered is the current one', () => {
  assert.equal(rerankerCurrent({ choice: 'tei', choices: [tei] }), 'tei');
});

test('a saved llamacpp choice missing from choices is kept, so switching off sends it back', () => {
  const svc = { choice: 'llamacpp:synthetic-rank', choices: [tei] };
  assert.equal(rerankerCurrent(svc), 'llamacpp:synthetic-rank');
  assert.equal(rerankerCurrent({ choice: 'llamacpp:synthetic-rank', choices: [] }), 'llamacpp:synthetic-rank');
});

test('nothing saved, or an unknown non-llamacpp id, is not a current value', () => {
  assert.equal(rerankerCurrent({ choice: null, choices: [tei] }), '');
  assert.equal(rerankerCurrent({ choices: [tei] }), '');
  assert.equal(rerankerCurrent({ choice: 'gone', choices: [tei] }), '');
});

test('the component sends the current choice when toggling, and every locale has the Creative note', () => {
  const tsx = fs.readFileSync(path.join(__dirname, '../../src/components/models/ServiceAssignments.tsx'), 'utf8');
  assert.match(tsx, /saveReranker\(on, current \|\| null\)/);
  const dir = path.join(__dirname, '../../src/i18n/models');
  for (const l of ['de-DE', 'en-GB', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    assert.match(fs.readFileSync(path.join(dir, `${l}.ts`), 'utf8'), /'mm\.assign\.creativeNote': ".{20,}"/, l);
  }
});
