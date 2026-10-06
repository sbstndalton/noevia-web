'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { lint } = require('../../scripts/lint-design.cjs');

test('flags one-sided accent borders but not blockquotes, hairlines or allowed cases', () => {
  const rules = (css) => lint(css).map((f) => `${f.rule}@${f.line}`);
  assert.deepEqual(rules('.card {\n  border-left: 3px solid var(--accent);\n}'), ['side-tab@2']);
  assert.deepEqual(rules('.card { border: 1px solid red; border-left-width: 4px; }'), ['side-tab@1']);
  assert.deepEqual(rules('.panel { border-left: 1px solid var(--border); }'), []);
  assert.deepEqual(rules('.markdown blockquote { border-left: 3px solid var(--accent); }'), []);
  assert.deepEqual(rules('/* design-lint: allow side-tab — miniature sidebar */\n.preview { border-left: 25px solid var(--chrome); }'), []);
});

test('flags overshooting easing and gradient text only', () => {
  assert.deepEqual(lint('a { transition: transform .2s cubic-bezier(0.16, 1, 0.3, 1); }'), []);
  assert.equal(lint('a { transition: transform .2s cubic-bezier(.34,1.56,.64,1); }')[0].rule, 'overshoot-ease');
  assert.equal(lint('h1 { -webkit-background-clip: text; background-clip: text; }').length, 2);
});

test('font sizes come from the type scale and weights from four steps', () => {
  // HIG typography: a small hierarchy of text styles, no in-between weights.
  const rules = (css) => lint(css).map((f) => f.rule);
  assert.deepEqual(rules('p { font-size: var(--text-body); font-weight: 600; }'), []);
  assert.deepEqual(rules('p { font-size: 13px; }'), []);
  assert.deepEqual(rules('p { font-size: 12.5px; }'), ['type-scale']);
  assert.deepEqual(rules('p { font-size: 14.5px; }'), ['type-scale']);
  assert.deepEqual(rules('p { font-size: 18px; }'), ['type-scale']);
  assert.deepEqual(rules('p { font-size: 0.75rem; }'), ['type-scale']);
  assert.deepEqual(rules('p { font-size: inherit; font-size: 1em; }'), []);
  assert.deepEqual(rules('b { font-weight: 550; }'), ['font-weight']);
  assert.deepEqual(rules('b { font-weight: 650 }'), ['font-weight']);
  assert.deepEqual(rules('b { font-weight: bold; font-weight: 700; }'), []);
  assert.deepEqual(rules('--text-body: 13px;'), []);
});

test('flags var() references to tokens defined nowhere in the stylesheets', () => {
  const { undefinedTokens } = require('../../scripts/lint-design.cjs');
  const files = [{ file: 'tokens.css', text: ':root { --bg-surface: #fff; --text-secondary: #555; }' },
    { file: 'a.css', text: '.x { background: var(--bg-surface); color: var(--muted-ink, #6b7280); }\n.y { --local: 1px; margin: var(--local); }' },
    { file: 'b.tsx', text: '<div style={{ color: "var(--text-secondary)", border: "var(--line)" }} />' }];
  assert.deepEqual(undefinedTokens(files).map((f) => `${f.file}:${f.line}:${f.token}`), ['a.css:1:--muted-ink', 'b.tsx:1:--line']);
});

test('the app stylesheets pass', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, '../../src');
  const findings = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(css|tsx)$/.test(f)).flatMap((f) => lint(fs.readFileSync(path.join(dir, f), 'utf8'), f));
  assert.deepEqual(findings, []);
  const { undefinedTokens } = require('../../scripts/lint-design.cjs');
  const pub = path.join(__dirname, '../../public');
  const sources = [[dir, /\.(css|tsx?)$/], [pub, /\.js$/]].flatMap(([root, re]) => fs.readdirSync(root, { recursive: true }).filter((f) => re.test(f)).map((f) => ({ file: f, text: fs.readFileSync(path.join(root, f), 'utf8') })));
  assert.deepEqual(undefinedTokens(sources), []);
});

// #247: every transition names its properties and takes its timing from the motion contract.
test('motion rules: no transition-all and no literal durations outside the contract', () => {
  const rules = (css, file = 'a.css') => lint(css, file).map((f) => f.rule);
  assert.deepEqual(rules('a { transition: opacity var(--motion-quick) var(--ease-quick); }'), []);
  assert.deepEqual(rules('a { transition: all var(--motion-quick) var(--ease-quick); }'), ['transition-all']);
  assert.deepEqual(rules('a { transition: var(--motion-quick); }'), ['transition-all']);
  assert.deepEqual(rules('a { transition-property: all; }'), ['transition-all']);
  assert.deepEqual(rules('a { transition: opacity 120ms ease; }'), ['motion-token']);
  assert.deepEqual(rules('a { animation: motion-spin 1.6s linear infinite; }'), ['motion-token']);
  assert.deepEqual(rules('a { transition: none; animation: none; }'), []);
  assert.deepEqual(rules(':root { --motion-quick: 160ms; }', 'src/styles/tokens.css'), []);
  assert.deepEqual(rules('* { transition-duration: 1ms !important; }', 'src/styles/motion.css'), []);
  // Scripts and components are out of scope for the CSS motion rules.
  assert.deepEqual(rules('a { transition: opacity 120ms ease; }', 'x.tsx'), []);
});

// #346: every dialog's ::backdrop reads --scrim / --scrim-blur instead of its own literal
// rgba()/blur(), so Reduce transparency and Increase contrast can flatten every scrim at once.
test('a ::backdrop must use --scrim and --scrim-blur, not a literal color or blur', () => {
  const rules = (css) => lint(css, 'a.css').map((f) => f.rule);
  assert.deepEqual(rules('.confirm-dialog::backdrop { background: var(--scrim); backdrop-filter: blur(var(--scrim-blur)); }'), []);
  assert.deepEqual(rules('.confirm-dialog::backdrop { background: rgba(0,0,0,.5); }'), ['backdrop-scrim']);
  assert.deepEqual(rules('.confirm-dialog::backdrop { background: #000; }'), ['backdrop-scrim']);
  assert.deepEqual(rules('.confirm-dialog::backdrop { background: var(--scrim); backdrop-filter: blur(2px); }'), ['backdrop-scrim']);
  assert.deepEqual(rules('.confirm-dialog::backdrop { background: rgba(0,0,0,.5); backdrop-filter: blur(2px); }').length, 2);
  // A fully transparent backdrop (a native <dialog> that draws its own chrome) is not a scrim.
  assert.deepEqual(rules('.native-modal::backdrop { background: transparent; }'), []);
  // Family/theme overrides layered onto an already-tokenized base rule are a separate, existing
  // system (#249) and stay out of scope for this fix.
  assert.deepEqual(rules("[data-family='contemporary'] dialog.dialog-sheet::backdrop { background: rgba(0,0,0,.32); }"), []);
  assert.deepEqual(rules('dialog:has(> .dialog-sheet)::backdrop { background: rgba(0,0,6,.38); }'), []);
});

test('a weight may come from a --*-weight token, which is itself held to four steps', () => {
  const rules = (css) => lint(css, 'a.css').map((f) => f.rule);
  assert.deepEqual(rules('h1 { font-weight: var(--display-weight, 600); }'), []);
  assert.deepEqual(rules(':root { --display-weight: 500; }'), []);
  assert.deepEqual(rules(':root { --display-weight: 450; }'), ['font-weight']);
  assert.deepEqual(rules('h1 { font-weight: var(--anything); }'), ['font-weight']);
});

// #529: every corner in component CSS comes from the family's shape tokens, so one theme cannot
// mix a hard-coded 24px composer with 20px sheets. Only square, circle, pill and inherit are
// literal; tokens.css and themes.css define the tokens.
test('border-radius reads a --radius-* token; 0, 50%, 999px and inherit are the only literals', () => {
  const rules = (css, file = 'src/styles/a.css') => lint(css, file).map((f) => f.rule);
  for (const ok of ['var(--radius-control)', 'var(--radius-surface) var(--radius-surface) 0 0', '0', '50%', '999px', 'inherit',
    'var(--radius-pill)', 'max(4px, calc(var(--radius-overlay) - 6px))', 'calc(var(--radius-overlay) - 4px)', 'var(--radius-control) !important']) {
    assert.deepEqual(rules(`.x { border-radius: ${ok}; }`), [], ok);
  }
  assert.deepEqual(rules('.composer { border-radius: 24px; }'), ['radius-token']);
  assert.deepEqual(rules('.chip { padding: 0 9px; border-radius: 10px; background: none; }'), ['radius-token']);
  assert.deepEqual(rules('.bar { border-radius: 0 4px 4px 0; }'), ['radius-token']);
  assert.deepEqual(rules('.tab::after { border-radius: 3px 3px 0 0; }'), ['radius-token']);
  assert.deepEqual(rules('.x { border-radius: 1rem; }'), ['radius-token']);
  assert.deepEqual(rules('.x { border-top-left-radius: 6px; }'), ['radius-token']);
  assert.deepEqual(rules('.x { border-start-end-radius: 6px; }'), ['radius-token']);
  // A literal fallback pins one family's corner wherever the token is missing.
  assert.deepEqual(rules('.x { border-radius: var(--radius-control, 8px); }'), ['radius-token']);
  // A calc() that is not built on a shape token is still a hard-coded corner.
  assert.deepEqual(rules('.x { border-radius: calc(8px + 2px); }'), ['radius-token']);
  assert.deepEqual(rules('.x { border-radius: var(--my-corner); }'), ['radius-token']);
  // Token definitions, custom properties named *-radius and non-CSS files are out of scope.
  assert.deepEqual(rules('[data-family=\'glass\'] { --radius-control: 12px; }', 'src/styles/themes.css'), []);
  assert.deepEqual(rules('.x { border-radius: 12px; }', 'src/styles/tokens.css'), []);
  assert.deepEqual(rules('.x { --thumb-radius: 12px; }'), []);
  assert.deepEqual(rules('.x { border-radius: 12px; }', 'x.tsx'), []);
  assert.deepEqual(rules('/* design-lint: allow radius-token — a deliberate case */\n.x { border-radius: 3px; }'), []);
});

test('every component stylesheet in src/ keeps its corners on the shape tokens', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, '../../src');
  const css = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.css'));
  assert.ok(css.includes(path.join('styles', 'space-tiers.css')) && css.includes(path.join('styles', 'phone.css')), 'scans the tier and phone sheets');
  const findings = css.flatMap((f) => lint(fs.readFileSync(path.join(dir, f), 'utf8'), f)).filter((f) => f.rule === 'radius-token');
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.message}`), []);
});
