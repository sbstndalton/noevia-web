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

// #1879: the Sources header and the list are counted by one function; a source whose length is not yet
// known never moves between the counted list and the not-readable list.
test('#1879: the header count equals the readable rows, a partial or processing source included', () => {
  const files = [
    { name: 'a.txt', textRef: ref, chars: 10 },
    { name: 'b.pdf', textRef: ref, chars: 30, document: { state: 'partial', pages: 9 } },
    { name: 'c.pdf', textRef: ref, chars: 5, document: { state: 'processing' } },
    { name: 'd.pdf', chars: 0, document: { state: 'failed', error: 'synthetic' } },
  ];
  const counts = status.sourceCounts({ files, assets: [{ id: 'i1', name: 'old.png' }, { id: 'i2', name: 'x.png', sourceName: 'x.png' }] });
  assert.equal(counts.counted, 4, 'a, b (partial), c (processing) and one earlier image upload');
  assert.equal(counts.notReadable, 1);
  assert.equal(counts.rows, 5);
  assert.equal(status.sourceCounts({ files: files.slice(0, 3) }).counted, 3, 'with one source partial the header equals the list length');
});

test('#1879: a failed document with neither text nor length is unknown, so it is not moved to Not readable', () => {
  const failed = { state: 'failed', error: 'synthetic' };
  const before = status.sourceCounts({ files: [{ name: 'a.pdf', document: failed }] });
  const after = status.sourceCounts({ files: [{ name: 'a.pdf', textRef: ref, chars: 80, document: failed }] });
  assert.equal(before.counted, after.counted, 'the count does not flip when the length arrives');
  assert.equal(status.sourceCounts({ files: [{ name: 'a.pdf', textRef: ref, chars: 0, document: failed }] }).counted, 0, 'a known-empty failed document stays uncounted');
});
