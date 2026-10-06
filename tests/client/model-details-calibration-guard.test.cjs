'use strict';
// The Details view for the system routing model (Laya) must not offer calibration or other
// tuning/preset-editing actions: the server already refuses calibration for it with 400 (#83),
// and Tune/Delete are hidden via isSystemModel (LibraryTab.tsx). This checks, at the source
// level, that every <NativeCalibration .../> render site in the model manager UI is gated by
// isSystemModel(name), the same guard already used for Tune/Delete/Rename/Remove.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8'); }

// Returns true if every <NativeCalibration render site sits inside a nearby branch that is
// only reached when `!system` (or an equivalent isSystemModel(...) check) is true — either
// `{!system && ... <NativeCalibration` or `{system ? <note> : <NativeCalibration`.
function calibrationSitesAreGuarded(src) {
  const positions = [];
  let from = 0;
  while (true) {
    const i = src.indexOf('<NativeCalibration', from);
    if (i === -1) break;
    positions.push(i);
    from = i + 1;
  }
  assert.ok(positions.length > 0, 'expected at least one <NativeCalibration usage to check');
  for (const i of positions) {
    const before = src.slice(Math.max(0, i - 400), i);
    const guarded = /\{!system\s*&&/.test(before.slice(-200)) || /!isSystemModel\(name\)\s*&&\s*<?\s*$/.test(before)
      || /system\s*\?[\s\S]*:\s*$/.test(before);
    assert.ok(guarded, `NativeCalibration render (offset ${i}) not visibly guarded by isSystemModel:\n${before}`);
  }
}

test('LibraryTab Details panel hides calibration for the system routing model', () => {
  const src = read('src/components/models/LibraryTab.tsx');
  assert.match(src, /const system = isSystemModel\(m\.name\)/);
  calibrationSitesAreGuarded(src);
  // The same "System · routing" note used for Tune/Delete must appear for the calibration gap too.
  assert.match(src, /system \? <p className="mm-note" role="status">\{t\('model.systemLabel'\)\}/);
});

test('ConfigureTab (Tune settings) also hides calibration and auto-tune actions for the system routing model', () => {
  const src = read('src/components/models/ConfigureTab.tsx');
  assert.match(src, /const system = isSystemModel\(name\)/);
  calibrationSitesAreGuarded(src);
  assert.match(src, /\{system && <p className="mm-note" role="status">\{t\('model.systemLabel'\)\}/);
  // "Tune for this machine" and "Auto-tune and apply" must not render for the system model either.
  assert.match(src, /\{!system && <button className="modal-btn secondary" disabled=\{tuning \|\| busy\}/);
  assert.match(src, /\{!system && <details ref=\{autoTuneRef\} className="mm-disclosure mm-easy-autotune"/);
});

test('rename/remove stays available for an ordinary (non-system) model in ConfigureTab', () => {
  const src = read('src/components/models/ConfigureTab.tsx');
  // Regression guard for #81: the gate is `!isSystemModel(name)`, so any model whose id does not
  // start with "laya" must still see the Rename or delete disclosure once its settings exist.
  assert.match(src, /\{data\.exists && !isSystemModel\(name\) && <details className="mm-disclosure"><summary>\{t\('mm.editor.renameOrDelete'\)\}<\/summary>/);
});
