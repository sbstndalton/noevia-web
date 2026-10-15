'use strict';
// #1829: the chat side panel's Model line is the model that answered, never an embedding, reranking or system model.
// Synthetic model names only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const mods = {};
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, (id) => mods[id] || require(id));
  return m.exports;
}
mods['./model-system'] = load('model-system.ts');
mods['./model-kind'] = load('model-kind.ts');
mods['./model-residency'] = load('model-residency.ts');
const { pickInspectorModel } = load('inspector-model.ts');

const chat = { name: 'syn-chat-q4', labels: [], loaded: true };
const embed = { name: 'syn-embed-q8', labels: ['embedding'], loaded: true };
const rank = { name: 'syn-ranker', labels: ['reranking'], loaded: true };
const decide = { name: 'syn-decider', labels: [], loaded: true, system: true };
const auto = { routing: 'auto' };

test('the reply that answered wins over everything else', () => {
  assert.deepEqual(pickInspectorModel({ replyModel: 'syn-chat-q4', project: { routing: 'manual', model: 'other' }, models: [embed, chat] }), { kind: 'answered', model: 'syn-chat-q4' });
  assert.deepEqual(pickInspectorModel({ replyModel: 'syn-chat-q4', project: auto, models: [] }), { kind: 'answered', model: 'syn-chat-q4' });
});

test('with no reply yet, Auto shows the Auto summary and Manual shows the selected model', () => {
  assert.deepEqual(pickInspectorModel({ replyModel: null, project: auto, models: [embed, chat] }), { kind: 'auto' });
  assert.deepEqual(pickInspectorModel({ replyModel: undefined, project: { routing: 'manual', model: 'syn-chat-q4' }, models: [embed] }), { kind: 'selected', model: 'syn-chat-q4' });
});

test('an embedding or reranking model is never offered, from any source', () => {
  assert.deepEqual(pickInspectorModel({ replyModel: 'syn-embed-q8', project: { routing: 'manual' }, models: [embed, rank] }), { kind: 'none' });
  assert.deepEqual(pickInspectorModel({ replyModel: null, project: { routing: 'manual', model: 'syn-ranker' }, models: [embed, rank] }), { kind: 'none' });
  // The old behaviour picked the first resident model, which was the embedding model.
  assert.deepEqual(pickInspectorModel({ replyModel: null, project: { routing: 'manual' }, models: [embed, rank, chat] }), { kind: 'loaded', model: 'syn-chat-q4' });
});

test('a system or sidecar model (marked by the server) is never offered', () => {
  mods['./model-system'].rememberSystemModels([{ name: 'syn-decider', system: true }, { name: 'syn-chat-q4', system: false }]);
  assert.deepEqual(pickInspectorModel({ replyModel: 'syn-decider', project: { routing: 'manual' }, models: [decide] }), { kind: 'none' });
  assert.deepEqual(pickInspectorModel({ replyModel: null, project: { routing: 'manual' }, models: [decide, chat] }), { kind: 'loaded', model: 'syn-chat-q4' });
  mods['./model-system'].rememberSystemModels([]);
});

test('a sleeping or missing chat model is not reported as the loaded one', () => {
  const sleeping = { name: 'syn-sleepy', labels: [], loaded: true, status: 'sleeping' };
  assert.deepEqual(pickInspectorModel({ replyModel: null, project: { routing: 'manual' }, models: [{ ...chat, missingFile: true }] }), { kind: 'none' });
  assert.deepEqual(pickInspectorModel({ replyModel: null, project: { routing: 'manual' }, models: [sleeping, chat] }), { kind: 'loaded', model: 'syn-chat-q4' });
});

test('the Routing panel shows the Creative note under the Creative row', () => {
  const tsx = fs.readFileSync(path.join(__dirname, '../../src/components/models/ModelsSettings.tsx'), 'utf8');
  assert.match(tsx, /role === 'creative' && <p className="mm-note" data-testid="routing-creative-note">\{t\('mm\.assign\.creativeNote'\)\}<\/p>/);
});
