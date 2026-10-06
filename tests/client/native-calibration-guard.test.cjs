'use strict';
// NativeCalibration polls calibration status every 2s while a job is running, and starts a
// job with a POST that can itself already report a finished job (e.g. an instant/cached
// result). Two bugs this guards against:
//   1. A poll reply arriving after the component unmounted or `model` changed (switching
//      models) must not call onChanged for the wrong model — ConfigureTab's measured
//      context would otherwise flip using stale data.
//   2. A POST reply that is already finished must call onChanged immediately, or the
//      measured context in ConfigureTab stays stale until an unrelated refresh happens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../..', 'src/components/NativeCalibration.tsx'), 'utf8');

test('the running-job poll effect guards against replies after unmount/model change', () => {
  const effect = src.slice(src.indexOf('useEffect(() => {\n    if (!running) return;'), src.indexOf('}, [running, model]);') + 20);
  assert.match(effect, /let live = true;/, 'poll effect should track a live flag');
  assert.match(effect, /if \(!live\) return;/, 'poll callback must bail out once the effect has been cleaned up');
  assert.match(effect, /live = false;/, 'cleanup must flip the live flag before clearing the interval');
  assert.match(effect, /\[running, model\]/, 'effect must restart (and its old closure go stale) when the model changes');
});

test('start() calls onChanged immediately when the POST reply is already finished', () => {
  const start = src.slice(src.indexOf('const start = async'), src.indexOf('const cancel = async'));
  assert.match(start, /v\.status !== 'running'/, 'start() must check whether the returned job already finished');
  assert.match(start, /finishedRef\.current = v\.id;\s*onChanged\(\);/, 'start() must call onChanged for an already-finished job, not wait for the poll');
});
