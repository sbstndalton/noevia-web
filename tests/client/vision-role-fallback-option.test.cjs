'use strict';
// #442 follow-up (orchestrator review, 2026-09-26): Vision was narrowed to chat + vision-labelled
// models, so a role saved before that change (or naming Laya, or a chat model with no vision
// label) has no matching <option> in its role-appropriate list (roleModels). The old fallback
// only covered a model no longer INSTALLED at all (`!models.some(...)`), so a still-installed but
// now-unsuitable saved value fell back to the controlled <select> showing "— none —" while
// valueFor(role) kept sending the stale name on Save — which the server's #442 guard then 400s
// with no visible explanation. This is the same source-text-pattern approach as
// non-chat-model-picker-filters.test.cjs (no jsdom/@testing-library in this repo).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/models/ModelsSettings.tsx'), 'utf8');

test('a saved role that is not in roleModels gets a fallback option, whether or not it is still installed', () => {
  assert.match(src, /const savedUnavailable = !!saved && !roleModels\.some\(\(m\) => m\.name === saved\);/, 'the fallback must trigger for ANY role whose saved value is missing from roleModels, not only "not installed"');
  assert.match(src, /const savedInstalled = savedUnavailable && models\.some\(\(m\) => m\.name === saved\);/);
  assert.match(src, /\{savedUnavailable && <option value=\{saved\}>\{t\(savedInstalled \? 'mm\.route\.unsuitableOption' : 'mm\.route\.notInstalledOption', \{ model: saved \?\? '' \}\)\}<\/option>\}/, 'an installed-but-unsuitable value must say so, distinctly from a missing one');
});

test('an installed-but-unsuitable saved role also shows an inline warning under its select', () => {
  assert.match(src, /\{savedInstalled && <p className="mm-note warn" role="alert">\{t\('mm\.route\.unsuitableWarning', \{ model: saved \?\? '' \}\)\}<\/p>\}/);
});

test('every locale defines the two new keys with the same {model} placeholder as English', () => {
  const en = fs.readFileSync(path.join(__dirname, '../../src/i18n/models/en-GB.ts'), 'utf8');
  for (const key of ['mm.route.unsuitableOption', 'mm.route.unsuitableWarning']) {
    assert.match(en, new RegExp(`'${key.replace(/[.]/g, '\\.')}':`), `${key} defined in en-GB.ts`);
  }
  for (const locale of ['de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    const text = fs.readFileSync(path.join(__dirname, `../../src/i18n/models/${locale}.ts`), 'utf8');
    for (const key of ['mm.route.unsuitableOption', 'mm.route.unsuitableWarning']) {
      const match = new RegExp(`'${key.replace(/[.]/g, '\\.')}':\\s*"([^"]*)"`).exec(text);
      assert.ok(match, `${locale} defines ${key}`);
      assert.match(match[1], /\{model\}/, `${locale} ${key} keeps the {model} placeholder`);
    }
  }
});
