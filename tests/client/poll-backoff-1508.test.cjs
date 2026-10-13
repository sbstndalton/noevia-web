'use strict';
// #1508: background polls back off. The stats snapshot runs every STATS_POLL_MS (15 s, not 2.5 s), and
// the diary storage-status poll waits longer as it fails or settles, instead of 3 s forever.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const src = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const code = ts.transpileModule(src('src/diary-storage-poll.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { exports: mod.exports, require: () => ({}) });
const { storagePollDelayMs } = mod.exports;

test('a hidden tab never schedules a storage-status read', () => {
  assert.equal(storagePollDelayMs({ backup: 'pending' }, false, 0), null);
  assert.equal(storagePollDelayMs(null, false, 3), null);
});

test('a finished or unconfigured backup stops polling', () => {
  assert.equal(storagePollDelayMs({ backup: 'complete' }, true, 0), null);
  assert.equal(storagePollDelayMs({ backup: 'not_configured' }, true, 0), null);
});

test('a running backup is read every 5 s and a failed one every 15 s', () => {
  assert.equal(storagePollDelayMs({ backup: 'pending' }, true, 0), 5000);
  assert.equal(storagePollDelayMs({ backup: 'failed' }, true, 0), 15000);
});

test('a status that will not load backs off from 3 s, doubling, capped at 60 s', () => {
  assert.equal(storagePollDelayMs(null, true, 0), 3000);
  assert.equal(storagePollDelayMs(null, true, 1), 6000);
  assert.equal(storagePollDelayMs(null, true, 2), 12000);
  assert.equal(storagePollDelayMs(null, true, 3), 24000);
  assert.equal(storagePollDelayMs(null, true, 4), 48000);
  assert.equal(storagePollDelayMs(null, true, 9), 60000);
});

test('DiaryStorageStatus schedules through storagePollDelayMs with failure counting', () => {
  const s = src('src/components/DiaryStorageStatus.tsx');
  assert.match(s, /storagePollDelayMs\(current, document\.visibilityState === 'visible', failures\)/);
  assert.match(s, /failures \+= 1/);
  assert.match(s, /failures = 0;/);
  assert.doesNotMatch(s, /setInterval\(\(\) => void poll\(\), 3000\)/, 'the fixed 3 s interval is gone');
});

test('the stats snapshot poll runs every 15 s, not every 2.5 s, and stays visibility-aware', () => {
  const app = src('src/App.tsx');
  assert.match(app, /const STATS_POLL_MS = 15_000;/);
  assert.match(app, /setInterval\(tick, STATS_POLL_MS\)/);
  assert.doesNotMatch(app, /setInterval\(tick, 2500\)/);
  assert.match(app, /if \(pending \|\| document\.visibilityState === 'hidden'\) return;/);
});
