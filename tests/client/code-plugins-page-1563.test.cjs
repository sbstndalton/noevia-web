// #1563: Code → Plugins was labelled "Interface preview · no execution" while it is the live Customise
// page (Skills, Connectors, MCP servers, with real data and Add actions). The page no longer carries the
// preview label, its header and nav name match Customise, and it lays out top-aligned and scrolling as
// Customise does in Chat instead of centred in the free height. Source contracts: layout is not measurable
// from Node, and the catalogue text is checked in every locale.
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

const workspace = fs.readFileSync(path.join(SRC, 'components/CodingWorkspace.tsx'), 'utf8');
const phoneCss = fs.readFileSync(path.join(SRC, 'styles/phone.css'), 'utf8');

test('the preview badge is not drawn on the Plugins page', () => {
  const header = workspace.slice(workspace.indexOf('<header className="coding-header">'), workspace.indexOf('</header>'));
  assert.match(header, /page==='Plugins'\s*\?\s*null\s*:\s*<span className="preview-badge">/, 'the Plugins page still shows the preview label');
  assert.match(header, /t\('code\.landing\.preview'\)/, 'the other Code pages lost their preview label');
});

test('the Plugins page is marked so it lays out top-aligned and scrolling, like Customise', () => {
  assert.match(workspace, /className=\{`coding-content\$\{page==='Plugins'\?' is-customise':''\}`\}/, 'the Plugins page is not marked is-customise');
  const rule = phoneCss.match(/\.app \.coding-content\.is-customise \{([^}]*)\}/);
  assert.ok(rule, 'no is-customise layout rule');
  assert.match(rule[1], /justify-content:\s*flex-start/, 'the page is still centred vertically');
  assert.match(rule[1], /overflow-y:\s*auto/, 'the page cannot scroll');
});

test('the Plugins nav entry and header name Customise, the same name the sidebar and page title use', () => {
  assert.equal(core.translate('en-GB', 'sidebar.code.plugins'), 'Customise');
  assert.equal(core.translate('en-US', 'sidebar.code.plugins'), 'Customize');
  for (const locale of Object.keys(LOCALES)) {
    assert.equal(core.translate(locale, 'sidebar.code.plugins'), core.translate(locale, 'sidebar.customise'), `${locale}: the Code entry does not use the Customise name`);
  }
});
