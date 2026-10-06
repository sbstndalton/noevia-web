'use strict';
// #443: the composer's Manual picker and the "Your models" card disagreed on a model's size by
// ~7% for the identical file (decimal GB vs binary GiB, both labelled "GB"). This is the one
// formatter both now go through — see src/model-size.ts for the sourcing rationale.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../../src/model-size.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports_ = {}; vm.runInNewContext(code, { exports: exports_ });
const { roundModelSizeGB: round, bytesToModelSizeGB: bytesToGB, formatModelSizeGB: format } = exports_;

test('rounds to one decimal place, the precision every model-size display uses', () => {
  assert.equal(round(3.14), 3.1);
  assert.equal(round(3.28), 3.3);
  assert.equal(round(3.3), 3.3);
  assert.equal(round(0), 0);
});

test('decimal GB from a raw byte count (bytes / 1e9), matching the server\'s own math', () => {
  // gemma-4-E2B_q4_0-it, the exact file #443 was filed against: llama.cpp reported 3.3e9 bytes,
  // and the composer showed 3.3 GB from that (server/llamacpp-manager.cjs: size / 1e9).
  assert.equal(bytesToGB(3.3e9), 3.3);
  // The Model Loader's binary-GiB string for the same file rounded to 3.1 "GB" (1024**3 basis) —
  // bytesToModelSizeGB must NOT reproduce that; the same byte count always yields the decimal
  // answer, never the binary one.
  assert.equal(bytesToGB(3.3e9), 3.3);
  assert.notEqual(bytesToGB(3.3e9), 3.1);
  assert.equal(bytesToGB(6065971520), 6.1);
});

test('formats a full display string, or null for anything unknown', () => {
  assert.equal(format(3.3), '3.3 GB');
  assert.equal(format(6.1), '6.1 GB');
  for (const v of [null, undefined, 0, -1, NaN, Infinity]) assert.equal(format(v), null);
});

test('the composer and Your-models sources for the SAME file converge on the identical string once routed through this formatter', () => {
  // Composer path: InstalledModel.sizeGB, already computed server-side as bytes / 1e9 rounded to
  // one decimal (server/models.cjs: `Math.round(m.size * 10) / 10`).
  const composerSizeGB = 3.3;
  // Library path: the file-scan entry's raw byte count for the identical file (FileEntry.bytes),
  // converted through this module instead of trusting the external service's own "size" string.
  const libraryBytes = 3300000000; // exactly the byte count llama.cpp reported for this fixture
  assert.equal(format(composerSizeGB), format(bytesToGB(libraryBytes)));
  assert.equal(format(composerSizeGB), '3.3 GB');
});
