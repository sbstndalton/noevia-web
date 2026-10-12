// #1502: "Cowork" stayed on screen as the name of a session mode after the rebrand to noevia: the Chat /
// Cowork toggle (English, hard-coded), the Projects cards ("Chat · Cowork", in every locale), and the Settings
// theme preview. The mode is now named Task on screen, translated in every locale, and the internal id
// 'cowork' (storage, routes, API) is untouched. Source contracts for the wiring and catalogue checks for
// the words, in every locale.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(relPath, resolveDir) {
  const full = path.posix.normalize(path.posix.join(resolveDir, relPath));
  if (cache[full]) return cache[full];
  const exports = {};
  cache[full] = exports;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, full + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const here = path.posix.dirname(full);
  vm.runInNewContext(code, {
    exports, Intl, console: { warn() {} }, Promise,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(m, here); },
  });
  return exports;
}

const core = load('i18n/core', '.');
const LOCALES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(LOCALES)) core.registerCatalogue(locale, load(`i18n/${locale}`, '.')[name]);
core.registerCatalogue('en-US', load('i18n/en-US', '.').EN_US);

const { MODE_LABELS, decideDispatch } = load('chat-mode', '.');
const composer = fs.readFileSync(path.join(SRC, 'components/ComposerModeBar.tsx'), 'utf8');
const general = fs.readFileSync(path.join(SRC, 'components/GeneralSettings.tsx'), 'utf8');

test('the mode is named Task in English, and the internal cowork id is unchanged', () => {
  assert.equal(MODE_LABELS.cowork.label, 'Task');
  assert.equal(core.translate('en-GB', 'projects.modeCowork'), 'Task');
  assert.equal(core.translate('en-US', 'projects.modeCowork'), 'Task');
  const decision = decideDispatch({ mode: 'cowork', harnessEnabled: true, canUseCode: true, projectId: null, repository: null });
  assert.equal(decision.reason, 'freeChat', 'the internal reason code moved');
  assert.equal(decision.harness, 'chat', 'the internal routing changed');
});

test('no locale still names the mode Cowork, and each has its own name for it', () => {
  for (const locale of Object.keys(LOCALES)) {
    const name = core.translate(locale, 'projects.modeCowork');
    assert.notEqual(name, 'Cowork', `${locale}: the mode is still called Cowork`);
    assert.notEqual(name, 'projects.modeCowork', `${locale}: the mode name is missing`);
    assert.doesNotMatch(core.translate(locale, 'mode.reason.freeChat'), /Cowork/, `${locale}: the free-chat notice still says Cowork`);
  }
});

test('the composer toggle, confirmation and caption use the translated names, not the hard-coded English', () => {
  assert.doesNotMatch(composer, /MODE_LABELS\[/, 'the composer still reads the hard-coded English label');
  assert.match(composer, /const MODE_NAME_KEYS: Record<ChatMode, MessageKey> = \{ chat: 'projects\.modeChat', cowork: 'projects\.modeCowork' \}/);
  assert.match(composer, /\{t\(MODE_NAME_KEYS\[option\]\)\}/, 'the toggle does not translate its names');
  assert.match(composer, /t\('mode\.keep', \{ mode: t\(MODE_NAME_KEYS\[mode\]\) \}\)/);
});

test('the Settings theme preview names the modes with the same translated words', () => {
  assert.doesNotMatch(general, /<span>Cowork<\/span>/, 'the theme preview still hard-codes Cowork');
  assert.match(general, /<span>\{t\('projects\.modeCowork'\)\}<\/span>/);
});
