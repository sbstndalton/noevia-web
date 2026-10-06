'use strict';
// #548/#545: Load/Unload is an engine control. Laya (own sidecar), the in-use embedding/reranker
// models (sidecarProtected) and presets whose model file is missing must not offer it, and a
// missing-file preset is not offered for tuning either. Source-pattern test, like the other
// library-tab-*.test.cjs files (no component renderer in this repo); the browser proof is
// qa/models-engine-controls.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const load = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
const src = load('components/models/LibraryTab.tsx');

test('the Load/Unload button only renders when the model is not system, sidecar-protected or missing its file', () => {
  assert.match(src, /const missing = m\.missingFile === true;/);
  assert.match(src, /const engineControls = !system && !protectedModel && !missing;/);
  assert.match(src, /\{engineControls && <button className="popup-tab" disabled=\{busy\}[^\n]*onClick=\{onToggle\}>/);
  assert.doesNotMatch(src, /\n\s*<button className="popup-tab" disabled=\{busy\}[^\n]*onClick=\{onToggle\}>/, 'no unconditional Load/Unload button remains');
});

test('a missing-file preset gets an explanatory note (after the system and sidecar notes) and no MTP/tune controls', () => {
  assert.match(src, /\{missing && !open && <p className="mm-note" role="status">\{t\('mm\.card\.missingNote'\)\}<\/p>\}/, 'the card itself carries the note');
  assert.match(src, /\{missing \? <p className="mm-note" role="status">\{t\('mm\.card\.missingNote'\)\}<\/p>\n\s*: !file && \(system \|\| protectedModel\)/, 'Details leads with the missing note, even for system models');
  assert.match(src, /runtimeOptions && !missing && <MtpControl/);
});

test('chat pickers and role pickers skip missing-file presets', () => {
  assert.match(load('components/ModelPopup.tsx'), /models\.filter\(\(m\) => !m\.missingFile && isChatGenerationModel/);
  assert.match(load('components/models/ModelsSettings.tsx'), /models\.filter\(\(m\) => !m\.missingFile && isChatGenerationModel/);
  assert.match(load('types.ts'), /missingFile\?: boolean;/);
});

test('Auto-tune resume is withheld when none of the run\'s models is installed (#551)', () => {
  assert.match(load('components/models/AutoTune.tsx'), /installedNames\.includes\(item\.model\)/);
  assert.match(load('components/models/OverviewTab.tsx'), /recoveryItems\(\{ autotune, calibration, downloads, now: Date\.now\(\), installed \}\)/);
});
