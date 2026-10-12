// #1558: Customise → Skills → Discover's "View" link opens github.com in a new tab, and the card did
// not say so: the visible word was only "View", and the accessible name replaced even that. The link
// now carries an external-link icon, a tooltip, and an accessible name that says it opens in a new
// tab, in every locale. Source contract on the markup, plus real catalogue text for each locale.
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
for (const [locale, name] of Object.entries(LOCALES)) core.registerSegment('customise', locale, load(`i18n/customise/${locale}`, '.')[`${name}_CUSTOMISE`]);
core.registerSegment('customise', 'en-GB', load('i18n/customise/en-GB', '.').EN_GB_CUSTOMISE);

const view = fs.readFileSync(path.join(SRC, 'components/plugins/PluginsView.tsx'), 'utf8');

test('the View link keeps its visible word and adds an external-link icon, a tooltip and a new-tab accessible name', () => {
  const link = view.match(/<a className="btn btn-secondary btn-sm plugin-card-link"[^>]*>[\s\S]*?<\/a>/);
  assert.ok(link, 'the card has no View link');
  assert.match(link[0], /t\('customise\.view'\)/, 'the visible word View is gone');
  assert.match(link[0], /<ShellIcon name="external-link"/, 'the link has no external-link icon');
  assert.match(link[0], /aria-label=\{t\('customise\.viewNewTabAria', \{ name: i\.name \}\)\}/, 'the accessible name does not say the link opens in a new tab');
  assert.match(link[0], /title=\{t\('customise\.opensInNewTab'\)\}/, 'the link has no tooltip saying it opens in a new tab');
  assert.match(link[0], /target="_blank"/);
});

test('the new-tab accessible name names the skill and says it opens in a new tab, in English', () => {
  assert.equal(core.translate('en-GB', 'customise.viewNewTabAria', { name: 'Pdf' }), 'View Pdf (opens in a new tab)');
  assert.equal(core.translate('en-GB', 'customise.opensInNewTab'), 'Opens in a new tab');
});

test('every locale has its own new-tab wording, with the same {name} placeholder as English', () => {
  const english = core.translate('en-GB', 'customise.viewNewTabAria', { name: 'X' });
  for (const locale of Object.keys(LOCALES)) {
    const aria = core.translate(locale, 'customise.viewNewTabAria', { name: 'X' });
    const tip = core.translate(locale, 'customise.opensInNewTab');
    assert.notEqual(aria, 'customise.viewNewTabAria', `${locale}: aria text is missing`);
    assert.notEqual(tip, 'customise.opensInNewTab', `${locale}: tooltip text is missing`);
    assert.notEqual(tip, core.translate('en-GB', 'customise.opensInNewTab'), `${locale}: tooltip is still English`);
    assert.match(aria, /X/, `${locale}: the skill name is not in the accessible name`);
    assert.equal(core.translate(locale, 'customise.viewNewTabAria').split('{name}').length - 1, 1, `${locale}: the {name} placeholder is missing or repeated`);
  }
  assert.match(english, /\(opens in a new tab\)$/);
});
