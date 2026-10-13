'use strict';
// #1581: the Code tab showed the harness as "pi 0.87.0" and listed prompt-preparation modes that are
// not offered as "Local architect - not available". Now the harness has a plain name (its version is
// kept for the hover text), unavailable modes are left out of the list, and the one operator note
// names no environment variable. Synthetic data only; the helpers are pure, so they load without React.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function load(rel) {
  const exports_ = {};
  const code = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, Object, Array, String, require: () => { throw Error('pure module only'); } });
  return exports_;
}

const en = catalogue('en-GB');
// The same contract as translate(): the key itself when a locale has no text for it.
const t = (key) => en[key] ?? key;
const copy = load('src/code-panel-copy.ts');
const ENV_LIKE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

test('#1581 the harness is named in plain words, not by its product id and version', () => {
  assert.equal(copy.harnessName(t, { id: 'pi', label: 'pi', version: '0.87.0' }), 'Coding assistant');
  assert.doesNotMatch(copy.harnessName(t, { id: 'pi', label: 'pi', version: '0.87.0' }), /0\.87|^pi\b/);
});

test('#1581 a harness with no plain name of its own keeps the server label', () => {
  assert.equal(copy.harnessName(t, { id: 'opencode', label: 'OpenCode', version: '1.18.31' }), 'OpenCode');
});

test('#1581 the version is kept for the hover text only', () => {
  assert.equal(copy.harnessVersionNote({ id: 'pi', label: 'pi', version: '0.87.0' }), 'pi 0.87.0');
  assert.equal(copy.harnessVersionNote({ id: 'pi', label: 'pi', version: null }), undefined);
});

test('#1581 prompt-preparation modes that are not offered are left out of the list', () => {
  const modes = [
    { id: 'direct', label: 'Direct', available: true },
    { id: 'local', label: 'Local architect', available: false },
    { id: 'frontier', label: 'Frontier architect', available: false },
    { id: 'planner', label: 'Planner', available: true },
  ];
  assert.deepEqual(copy.offeredPreparations(modes).map((m) => m.id), ['direct', 'planner']);
  assert.deepEqual(copy.offeredPreparations([]), []);
});

test('#1581 the preparation a task uses is the chosen one while offered, otherwise the first offered one', () => {
  const offered = [{ id: 'direct' }, { id: 'planner' }];
  assert.equal(copy.effectivePreparationId(offered, 'planner'), 'planner', 'a chosen mode still offered is kept');
  assert.equal(copy.effectivePreparationId(offered, 'local'), 'direct', 'a mode that dropped out falls back to the first offered');
  assert.equal(copy.effectivePreparationId([{ id: 'planner' }], 'direct'), 'planner');
  assert.equal(copy.effectivePreparationId([], 'direct'), 'direct', 'nothing offered: the default, as the server always has direct');
});

test('#1581 the select, the note and the start request all read the effective preparation', () => {
  const src = read('src/components/code/CodePanel.tsx');
  assert.match(src, /const selectedPreparation = effectivePreparationId\(offered, preparation\);/);
  assert.match(src, /<select id="code-preparation" value=\{selectedPreparation\}/);
  assert.match(src, /<PreparationNote mode=\{state\.promptPreparation\.find\(m => m\.id === selectedPreparation\)\}/);
  assert.match(src, /promptPreparation: selectedPreparation,/);
  assert.doesNotMatch(src, /promptPreparation: preparation[,}]/, 'the request never sends the raw state');
});

test('#1581 every interface locale has its own plain harness name', () => {
  for (const locale of LOCALES) {
    const text = catalogue(locale)['code.harness.pi.label'];
    assert.ok(typeof text === 'string' && text.trim(), `${locale} has code.harness.pi.label`);
    if (locale !== 'en-GB') assert.notEqual(text, en['code.harness.pi.label'], `${locale} is translated, not the English copy`);
    assert.doesNotMatch(text, /harn|\bpi\b/i, `${locale} does not say harness or pi`);
  }
});

test('#1581 the sandbox note names no environment variable and no harness jargon in any locale', () => {
  assert.match(en['code.panel.notSandboxed'], /code sandbox/);
  for (const locale of LOCALES) {
    const text = catalogue(locale)['code.panel.notSandboxed'];
    assert.doesNotMatch(text, ENV_LIKE, `${locale} shows no variable name`);
    assert.doesNotMatch(text, /CODE_HARNESS|harn/i, `${locale} says what runs, not the harness`);
  }
  assert.doesNotMatch(en['code.panel.notSandboxed'], ENV_LIKE);
});

test('#1581 the Code panel uses the plain names and offers only the modes that are available', () => {
  const src = read('src/components/code/CodePanel.tsx');
  assert.match(src, /from '\.\/\.\.\/\.\.\/code-panel-copy'|from '\.\.\/\.\.\/code-panel-copy'/);
  assert.match(src, /harnessName\(/, 'the harness is named through the plain-name helper');
  assert.match(src, /offeredPreparations\(state\.promptPreparation\)/, 'the preparation list is filtered to the offered modes');
  assert.doesNotMatch(src, /h\.label\}\{h\.version/, 'the select no longer prints the version beside the label');
  assert.doesNotMatch(src, /code\.panel\.notAvailable/, 'no "not available" suffix on an option');
  assert.doesNotMatch(src, /state\.harnesses\[0\]\.label\}/, 'the single-harness fact no longer prints the raw label');
});
