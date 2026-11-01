'use strict';
// #2276: the import answer's skipped[] reasons reach the user one sentence per distinct reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');

const code = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/components/data/import-summary.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' }).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const t = Object.assign((k) => k, { plural: (k, n) => `${k}:${n}`, locale: 'en-GB' });

test('distinct reasons are listed separately, "differs" included', () => {
  const skipped = [
    { title: 'A', reason: 'already in this account' },
    { title: 'B', reason: 'already in this account; the copy in this file differs and was not imported' },
    { title: 'C', reason: 'already in this account' },
    { title: 'D', reason: 'repeated in this file' },
    { title: 'E', reason: 'conversation list is full' },
    { title: 'F', reason: 'deleted while import was pending' },
  ];
  assert.deepEqual(mod.exports.skippedSummary(skipped, t), ['data.skipped:2', 'data.skippedDiffers:1', 'data.skippedRepeated:1', 'data.skippedOther:2']);
});

test('no skipped list says nothing', () => {
  assert.deepEqual(mod.exports.skippedSummary(undefined, t), []);
  assert.deepEqual(mod.exports.skippedSummary([], t), []);
});
