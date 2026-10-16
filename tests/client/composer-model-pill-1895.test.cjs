'use strict';
// #1895: the composer pill never names an embedding, reranking or system model. A Manual chat with no model pinned used
// to take the first loaded model of the installed list, which can be the embedding model. Synthetic names only.
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
const { chatGenerationModels } = (mods['./model-kind'] = load('model-kind.ts'));
const { modelChoiceLabel, LOCAL_MODEL_FALLBACK, NO_MODEL_SELECTED } = load('model-guidance.ts');

const chat = { name: 'syn-chat-q4', labels: [], loaded: false };
const chatLoaded = { ...chat, loaded: true };
const embed = { name: 'syn-vectors-q8', labels: ['embedding'], loaded: true };
const rank = { name: 'syn-order-q8', labels: ['reranking'], loaded: true };
const decide = { name: 'syn-decider', labels: [], loaded: true, system: true };
const manual = { routing: 'manual' };
const label = (choice, models) => modelChoiceLabel(choice, chatGenerationModels(models), true, 'default');

test('Manual with no model pinned never reads as a loaded embedding, reranking or system model', () => {
  assert.equal(label(manual, [embed, rank, chat]), LOCAL_MODEL_FALLBACK);
  assert.equal(label(manual, [embed, rank]), LOCAL_MODEL_FALLBACK);
  // the unfiltered list is what used to be shown
  assert.equal(modelChoiceLabel(manual, [embed, chat], true, 'default'), 'syn-vectors-q8');
});

test('the loaded chat model is shown when there is one, whichever order the list is in', () => {
  assert.equal(label(manual, [embed, rank, chatLoaded]), 'syn-chat-q4');
  assert.equal(label(manual, [chatLoaded, embed]), 'syn-chat-q4');
});

test('a system model (Laya-like) is excluded through its explicit kind, and a pinned non-chat model is not a selection', () => {
  mods['./model-system'].rememberSystemModels([{ name: 'syn-decider', system: true }]);
  assert.equal(label(manual, [decide]), LOCAL_MODEL_FALLBACK);
  assert.equal(label({ routing: 'manual', model: 'syn-vectors-q8' }, [embed, chatLoaded]), NO_MODEL_SELECTED);
  assert.equal(label({ routing: 'manual', model: 'syn-chat-q4' }, [embed, chatLoaded]), 'syn-chat-q4');
});

test('Auto, an unknown catalogue and a free chat are unchanged', () => {
  assert.equal(label({ routing: 'auto' }, [embed]), 'Auto (Fast/Smart)');
  assert.equal(chatGenerationModels(null), null);
  assert.equal(modelChoiceLabel(manual, chatGenerationModels(null), true, 'default'), LOCAL_MODEL_FALLBACK);
  assert.equal(label(null, [embed, chatLoaded]), 'Auto (Fast/Smart)');
  assert.equal(modelChoiceLabel(null, chatGenerationModels([embed, chatLoaded]), false, 'default'), 'syn-chat-q4');
});
