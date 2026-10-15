'use strict';
// #1806: GET /api/workspace lists a project's sources without their text (`chars` and a `textRef`
// pointer instead; the text is GET /api/projects/{id}/sources/text). The Sources status reads the
// length, not the text, and the project limits shown are the server's new defaults. Synthetic data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(name) {
  const exports_ = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, require: (id) => { throw Error(`unexpected require ${id}`); }, JSON, Object, Error, Math, Number, String, Array });
  return exports_;
}

const status = load('source-status.ts');
const ref = 'a'.repeat(64);

test('#1806: a failed document listed with its text length is not "unreadable"; one with no text is', () => {
  const failed = { state: 'failed', error: 'synthetic' };
  assert.equal(status.isUnreadableSource({ name: 'scan.pdf', textRef: ref, chars: 120, document: failed }), false, 'text kept from before');
  assert.equal(status.isUnreadableSource({ name: 'scan.pdf', textRef: ref, chars: 0, document: failed }), true);
  assert.equal(status.isUnreadableSource({ name: 'scan.pdf', content: '  ', document: failed }), true, 'a source with its text still judges the text');
});

test('#1806: the search-limited note shows for a listed source that has text', () => {
  const doc = { state: 'ready', indexing: 'failed', pages: 2 };
  assert.match(status.sourceStatus({ name: 'a.pdf', textRef: ref, chars: 500, document: doc }), /search limited/);
  assert.doesNotMatch(status.sourceStatus({ name: 'a.pdf', textRef: ref, chars: 0, document: doc }), /search limited/);
});

test('#1806: the project limits shown before the server answers are 1000 sources, 200 documents, 12 images', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '../../contracts/folder-import.json'), 'utf8'));
  assert.deepEqual(contract.projectLimits, { sources: 1000, documents: 200, images: 12 });
});
