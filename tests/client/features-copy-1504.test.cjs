'use strict';
// #1504: the Features page described Diary writing as "append-only" through the "MCP server", the
// toolbox filter as needing an "embedding model", and Code mode as a "coding harness in a per-task git
// worktree". Those feature rows (and the "framing reasoner" row, a term that is internal too) now use
// plain words in every locale. The technical names stay in the operator documentation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogue, English, LOCALES } = require('./i18n-catalogue.cjs');

const KEYS = ['features.item.diaryMcpWrite.label', 'features.item.diaryMcpWrite.description', 'features.item.toolRouter.description',
  'features.item.codeHarness.description', 'features.item.framingReasoner.label', 'features.item.framingReasoner.description'];
const INTERNAL = /append|MCP|embedding|Embedding|worktree|harness|Harness|reasoner|Reasoner|raisonneur|ragionatore|raciocinador|redeneer|Resoner|resonneringsmodell|resonemang/;

test('#1504 the English descriptions name what the user gets, not the internal mechanism', () => {
  const en = English();
  assert.equal(en['features.item.diaryMcpWrite.description'],
    'Let the assistant add new entries to your Diary, and only after you approve each one. It cannot change or delete what is already there.');
  assert.match(en['features.item.toolRouter.description'], /needs a search model/);
  assert.match(en['features.item.codeHarness.description'], /coding assistant on a separate copy of the code/);
  assert.equal(en['features.item.framingReasoner.label'], 'Short tool summaries');
});

test('#1504 no locale shows the internal terms in the rows it changed', () => {
  for (const locale of LOCALES) {
    const cat = catalogue(locale);
    for (const key of KEYS) assert.doesNotMatch(cat[key], INTERNAL, `${locale} ${key}: "${cat[key]}"`);
  }
});

test('#1504 the Diary row keeps the approval and append-only promise in plain words', () => {
  const en = English()['features.item.diaryMcpWrite.description'];
  assert.match(en, /only after you approve each one/);
  assert.match(en, /cannot change or delete/);
  assert.equal(catalogue('de-DE')['features.item.diaryMcpWrite.label'], 'Ins Tagebuch eintragen');
});
