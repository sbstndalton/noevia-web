'use strict';
// #2474 and #2475: the wiring the browser scripts (qa/wizard-resume-2474.cjs, qa/project-source-remove-2475.cjs) exercise.
// The repo has no component renderer here, so this reads the source, as project-view-delete-chat-confirm.test.cjs does.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const wizard = read('src/components/SetupWizard.tsx'), view = read('src/components/ProjectView.tsx');

test('#2474: a resumed wizard starts past the Diary step when the account already has Diary on', () => {
  assert.match(wizard, /export function resumeStep\(mode: 'resume' \| 'invited', diaryEnabled: boolean\): Step \{\s*if \(mode === 'resume'\) return 'provider';\s*return diaryEnabled \? 'prefs' : 'diary';/);
  assert.match(wizard, /useState<Step>\(mode === 'fresh' \? 'welcome' : resumeStep\(mode, initialUser\?\.diaryEnabled \?\? false\)\)/);
});

test('#2474: steps the account already shows as done are marked on the progress dots', () => {
  assert.match(wizard, /stepDone = \(s: Step\) => accountCreated && \(\(s === 'diary' && diaryEnabled\) \|\| \(s === 'passkey' && hasPasskey\)\)/);
  assert.match(wizard, /\(s !== step && stepDone\(s\)\) \? ' done'/);
});

test('#2475: Remove on a source stages a confirmation instead of patching the project at once', () => {
  const button = view.match(/aria-label=\{t\(deletable \? 'projects\.view\.deleteNamed'[\s\S]*?<\/button>/);
  assert.ok(button, 'source row button');
  assert.doesNotMatch(button[0], /onPatch/, 'the click must not patch directly');
  assert.match(button[0], /setConfirmSourceRemove\(f\.name\)/);
  const dialog = view.match(/\{confirmSourceRemove && \(\s*<ConfirmDialog[\s\S]*?\/>\s*\)\}/);
  assert.ok(dialog, 'a ConfirmDialog gated on confirmSourceRemove');
  assert.match(dialog[0], /danger/);
  assert.match(dialog[0], /removeSourceTitle', \{ name:/);
  assert.match(dialog[0], /onCancel=\{\(\) => setConfirmSourceRemove\(null\)\}/);
  assert.match(dialog[0], /onConfirm=\{\(\) => \{ const name = confirmSourceRemove; setConfirmSourceRemove\(null\); onPatch\(project\.id, \{ files: filesAfterRemoval\(project\.files, name\) \}\); \}\}/);
});

test('#2475: the confirm text exists in every shipped locale', () => {
  for (const loc of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const src = read(`src/i18n/${loc}.ts`);
    for (const key of ['projects.view.removeSourceTitle', 'projects.view.removeSourceBody']) assert.match(src, new RegExp(`'${key.replace(/\./g, '\\.')}': `), `${loc} ${key}`);
    assert.match(src, /\{name\}/);
  }
});
