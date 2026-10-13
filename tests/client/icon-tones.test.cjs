'use strict';
// #1623: two-tone icons. A decorative icon (information only) keeps the neutral outline and draws
// one inner part in the theme accent; a control (anything you can press) is the same outline in one
// neutral colour. This pins the Icon tones, the per-glyph accent map, the rule that no pressable
// thing renders an accent part (in the source and in the CSS), and the accent's contrast in every
// theme family x mode x palette. Browser proof with screenshots: qa/icon-tones-1623.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { audit } = require('../../scripts/icon-tone-audit.cjs');

const root = path.join(__dirname, '../..');
const cache = new Map();
/** Loads a TSX/TS module from src with its relative imports (real React). */
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  cache.set(file, module.exports);
  const resolve = (m) => { const base = path.join(path.dirname(file), m); return fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`; };
  vm.runInNewContext(js, { module, exports: module.exports, require: (m) => (m.startsWith('.') ? load(resolve(m)) : require(m)) });
  cache.set(file, module.exports);
  return module.exports;
}
const { Icon } = load(path.join(root, 'src/components/icons/Icon.tsx'));
const { ShellIcon, SHELL_ICONS } = load(path.join(root, 'src/components/ShellIcon.tsx'));
const { LUCIDE } = load(path.join(root, 'src/components/icons/lucide.ts'));
const { ICON_ACCENTS, PLAIN_GLYPHS } = load(path.join(root, 'src/components/icons/accents.ts'));
const html = (el) => renderToStaticMarkup(el);
const icon = (props) => html(React.createElement(Icon, props));
const ACCENT_PART = /class="ic-af?"/;
/** The outline of a rendered icon: its nodes without the accent classes and without the fill layer. */
const outline = (markup) => markup.replace(/<([a-z]+) [^>]*class="ic-af"[^>]*>(?:<\/\1>)?/g, '').replace(/ class="ic-a"/g, '').replace(/ data-tone="[a-z]+"/, '');

test('the default tone is control: one neutral colour, no accent part, today\'s outline', () => {
  for (const name of Object.keys(LUCIDE)) {
    const out = icon({ name });
    assert.match(out, /data-tone="control"/, name);
    assert.doesNotMatch(out, ACCENT_PART, `${name}: a control renders no accent part`);
    assert.match(out, /stroke="currentColor"/, name);
    assert.equal(out, icon({ name, tone: 'control' }), `${name}: control is the default`);
  }
});

test('a decorative icon is the same outline plus exactly its mapped accent part', () => {
  for (const [name, accent] of Object.entries(ICON_ACCENTS)) {
    const control = icon({ name, tone: 'control' }), decorative = icon({ name, tone: 'decorative' });
    assert.match(decorative, /data-tone="decorative"/, name);
    assert.equal(outline(decorative), outline(control), `${name}: the outline is the control glyph`);
    const stroked = (decorative.match(/class="ic-a"/g) || []).length, filled = (decorative.match(/class="ic-af"/g) || []).length;
    assert.equal(stroked, (accent.stroke || []).length, `${name}: stroked accent parts`);
    assert.equal(filled, (accent.fill || []).length, `${name}: filled accent parts`);
    assert.ok(stroked + filled > 0, `${name}: has an accent part`);
    // A fill sits UNDER the outline (painted first) and never draws a stroke of its own.
    if (filled) assert.match(decorative, /^<svg[^>]*><[a-z]+ [^>]*class="ic-af" stroke="none"/, `${name}: the fill is the bottom layer`);
  }
});

test('every vendored glyph is classified once: an accent part, or plain', () => {
  const glyphs = Object.keys(LUCIDE);
  for (const name of glyphs) {
    const inAccents = Object.hasOwn(ICON_ACCENTS, name), plain = PLAIN_GLYPHS.includes(name);
    assert.ok(inAccents !== plain, `${name} must be in exactly one of ICON_ACCENTS / PLAIN_GLYPHS`);
  }
  for (const name of [...Object.keys(ICON_ACCENTS), ...PLAIN_GLYPHS]) assert.ok(LUCIDE[name], `${name} is not vendored`);
  for (const [name, accent] of Object.entries(ICON_ACCENTS)) {
    const indices = accent.stroke || [];
    assert.equal(new Set(indices).size, indices.length, `${name}: duplicate index`);
    for (const i of indices) assert.ok(Number.isInteger(i) && i >= 0 && i < LUCIDE[name].length, `${name}: index ${i} is a node of the glyph`);
    // "One inner part": never the whole glyph, or the icon is just recoloured.
    assert.ok(indices.length < LUCIDE[name].length, `${name}: the accent is a part, not the whole glyph`);
  }
  // The reference glyphs the owner named, where we vendor them: the gear's hub, the folder's tab.
  assert.equal(JSON.stringify(ICON_ACCENTS.settings), JSON.stringify({ stroke: [1] }));
  assert.equal(LUCIDE.settings[1][0], 'circle', 'the gear hub is the inner circle');
  assert.ok(ICON_ACCENTS.folder.fill?.length, 'the folder tab is a solid fill');
});

test('plain glyphs and unknown names stay one colour even when decorative', () => {
  for (const name of PLAIN_GLYPHS) assert.doesNotMatch(icon({ name, tone: 'decorative' }), ACCENT_PART, name);
  const unknown = icon({ name: 'no-such-glyph', tone: 'decorative' });
  assert.doesNotMatch(unknown, ACCENT_PART, 'the neutral circle fallback has no accent');
  assert.match(unknown, /<circle cx="12" cy="12" r="10"/);
});

test('ShellIcon passes the tone through and defaults to control', () => {
  assert.match(html(React.createElement(ShellIcon, { name: 'settings' })), /data-tone="control"/);
  assert.doesNotMatch(html(React.createElement(ShellIcon, { name: 'settings' })), ACCENT_PART);
  const deco = html(React.createElement(ShellIcon, { name: 'settings', tone: 'decorative' }));
  assert.match(deco, /data-icon="settings" data-tone="decorative"/);
  assert.match(deco, /<circle cx="12" cy="12" r="3" class="ic-a"><\/circle>/, 'the gear hub is the accent part');
  for (const lucide of Object.values(SHELL_ICONS)) assert.ok(LUCIDE[lucide]);
});

// ── The rule in the source: nothing pressable renders an accent part. ─────────────────────────
const rows = audit();

test('no decorative icon is written inside a button, link, menu item or other control', () => {
  const offenders = rows.filter((r) => r.tone === 'decorative' && r.interactive);
  assert.deepEqual(offenders, [], offenders.map((r) => `${r.file}:${r.line} ${r.icon} in ${r.where}`).join('\n'));
  // Menu definitions ({ label, icon: <ShellIcon/> }) render inside role="menuitem": controls.
  assert.ok(rows.some((r) => r.where === 'menu item (icon:)' && r.tone === 'control'));
});

test('the audit sees controls as controls (it would catch a decorative icon in one)', () => {
  const at = (file, icon) => rows.filter((r) => r.file === file && r.icon === icon);
  assert.ok(at('src/components/CloseButton.tsx', 'close').every((r) => r.interactive && r.where === '<button>'));
  assert.ok(at('src/components/AccountMenu.tsx', 'settings').every((r) => r.interactive));
  assert.ok(at('src/components/DiaryModal.tsx', 'external-link').every((r) => r.interactive && r.where === '<a>'));
  assert.ok(rows.filter((r) => r.file === 'src/components/Sidebar.tsx').every((r) => r.interactive && r.tone === 'control'), 'every sidebar icon is pressable');
  assert.ok(rows.length >= 150, `${rows.length} icon elements found`);
});

test('information-only icons are decorative: empty states, type markers, status and section symbols', () => {
  const decorative = (file, icon, where) => {
    const hit = rows.filter((r) => r.file === file && r.icon === icon && (!where || r.where.startsWith(where)));
    assert.ok(hit.length, `${file} ${icon} found`);
    for (const r of hit) assert.equal(r.tone, 'decorative', `${file}:${r.line} ${icon} (${r.where})`);
  };
  decorative('src/components/EmptyState.tsx', '{icon}');
  decorative('src/components/ProjectView.tsx', 'file', 'span.source-name');
  decorative('src/components/ProjectView.tsx', 'folder');
  decorative('src/components/EditProjectModal.tsx', 'folder');
  decorative('src/components/code/CodePanel.tsx', 'security');
  decorative('src/components/browser/BrowserPanel.tsx', 'security');
  decorative('src/components/plugins/PluginsView.tsx', 'server');
  decorative('src/components/FrameChips.tsx', 'folder');
  decorative('src/components/ChatView.tsx', 'file');
  decorative('src/components/ProjectsView.tsx', 'pin', 'span.project-card-pin');
  decorative('src/components/SettingsShell.tsx', 'search');
  decorative('src/components/research/ResearchPanel.tsx', 'folder');
});

// ── The rule in the CSS: the accent is the theme's, guarded inside controls, neutral when forced. ──
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const components = strip(fs.readFileSync(path.join(root, 'src/styles/system/components.css'), 'utf8'));

test('the accent part is painted with --icon-accent only on a decorative icon', () => {
  assert.match(components, /\.ic\[data-tone='decorative'\] \.ic-a \{ stroke: var\(--icon-accent\); \}/);
  assert.match(components, /\.ic\[data-tone='decorative'\] \.ic-af \{ fill: var\(--icon-accent\); \}/);
  assert.doesNotMatch(components, /\.ic\[data-tone='control'\][^{]*\{[^}]*icon-accent/, 'a control never reads the accent');
});

test('inside anything pressable the accent part falls back to the neutral colour (CSS guard, last)', () => {
  const guards = [...components.matchAll(/:is\(([^)]*)\) \.ic\[data-tone='decorative'\] (\.ic-af?(?:\[fill='currentColor'\])?) \{ ([^}]*) \}/g)];
  assert.equal(guards.length, 3, 'stroke, dot fill and fill-layer guards');
  for (const [, list] of guards) for (const hook of ['button', 'a', 'summary', 'label', "[role='button']", "[role='link']", "[role='menuitem']", "[role='menuitemradio']", "[role='menuitemcheckbox']", "[role='tab']", "[role='option']", "[role='switch']", "[role='checkbox']", "[role='radio']"]) {
    assert.ok(list.split(',').map((s) => s.trim()).includes(hook), `the guard covers ${hook}`);
  }
  assert.deepEqual(guards.map((g) => [g[2], g[3]]), [['.ic-a', 'stroke: inherit;'], [".ic-a[fill='currentColor']", 'fill: currentColor;'], ['.ic-af', 'fill: none;']]);
  // Last in the file, so it outranks the forced-colours rule as well as the accent rule.
  assert.ok(components.lastIndexOf('@media (forced-colors: active)') < guards[0].index);
});

test('forced colours: the accent part takes the neutral colour', () => {
  const block = components.match(/@media \(forced-colors: active\) \{([\s\S]*?\n)\}/);
  assert.ok(block, 'a forced-colors block exists');
  assert.match(block[1], /\.ic\[data-tone='decorative'\] \.ic-a \{ stroke: currentColor; \}/);
  assert.match(block[1], /\.ic\[data-tone='decorative'\] :is\(\.ic-a\[fill='currentColor'\], \.ic-af\) \{ fill: currentColor; \}/);
});

// Token evaluation, as tests/client/theme-family-contrast.test.cjs models the cascade.
const stripMedia = (css) => strip(css).replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
const tokensCss = stripMedia(fs.readFileSync(path.join(root, 'src/styles/system/tokens.css'), 'utf8'));
const themesCss = stripMedia(fs.readFileSync(path.join(root, 'src/styles/system/themes.css'), 'utf8'));
const ACCENTS = ['iris', 'warm', 'cool', 'neutral', 'sage'];
const hex = (h) => h.slice(1).match(/../g).map((v) => parseInt(v, 16));
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = (h) => { const c = hex(h).map((v) => v / 255).map((v) => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const over = (rgb, a, bg) => toHex(rgb.map((c, i) => c * a + hex(bg)[i] * (1 - a)));
function values(family, mode, accent) {
  const applies = (s) => s === ':root' || s === '.theme-scope' || s === `[data-theme='${mode}']`
    || (s === ":root:not([data-theme='light'])" || s === ".theme-scope:not([data-theme='light'])") && mode === 'dark'
    || s === `[data-palette='${accent}']:not([data-theme='light'])` && mode === 'dark'
    || s === `[data-palette='${accent}'][data-theme='light']` && mode === 'light'
    || s === `[data-family='${family}']`
    || s === `[data-family='${family}']:not([data-theme='light'])` && mode === 'dark'
    || s === `[data-family='${family}'][data-theme='light']` && mode === 'light';
  const out = {};
  for (const css of [tokensCss, themesCss]) for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selector.split(',').map((s) => s.trim()).some(applies)) continue;
    for (const [, name, v] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[name] = v.trim();
  }
  return out;
}
function evaluator(family, mode, accent) {
  const v = values(family, mode, accent);
  const color = (expr, seen = new Set()) => {
    expr = expr.trim();
    if (/^#[\da-f]{6}$/i.test(expr)) return { rgb: hex(expr), a: 1 };
    const rgbA = expr.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/);
    if (rgbA) return { rgb: rgbA.slice(1, 4).map(Number), a: rgbA[4] === undefined ? 1 : Number(rgbA[4]) };
    const ref = expr.match(/^var\(--([\w-]+)\)$/);
    if (ref) { if (seen.has(ref[1])) throw Error(`cycle --${ref[1]}`); if (!v[ref[1]]) throw Error(`--${ref[1]} undefined`); return color(v[ref[1]], new Set([...seen, ref[1]])); }
    throw Error(`cannot evaluate ${expr}`);
  };
  const solid = (name, under) => { const c = color(`var(--${name})`); return c.a >= .999 ? toHex(c.rgb) : over(c.rgb, c.a, under); };
  return { v, color, solid };
}
const saturate = (color, s) => { const [r, g, b] = hex(color); const m = [[.213 + .787 * s, .715 - .715 * s, .072 - .072 * s], [.213 - .213 * s, .715 + .285 * s, .072 - .072 * s], [.213 - .213 * s, .715 - .715 * s, .072 + .928 * s]]; return toHex(m.map(([x, y, z]) => x * r + y * g + z * b)); };

test('--icon-accent is each theme\'s own accent, never a literal colour', () => {
  for (const family of ['editorial', 'contemporary', 'glass']) for (const mode of ['light', 'dark']) for (const accent of ACCENTS) {
    const e = evaluator(family, mode, accent);
    assert.equal(e.solid('icon-accent', '#000000'), e.solid('md-primary', '#000000'), `${family} ${mode} ${accent}`);
  }
  assert.doesNotMatch(values('editorial', 'dark', 'iris')['icon-accent'], /#|rgb/, 'a token reference, so a palette recolours it');
  // Palettes really differ (the colour shows up), and light differs from dark.
  const seen = new Set(ACCENTS.map((a) => evaluator('editorial', 'dark', a).solid('icon-accent', '#000000')));
  assert.equal(seen.size, ACCENTS.length);
});

for (const family of ['editorial', 'contemporary', 'glass']) for (const mode of ['light', 'dark']) for (const accent of ACCENTS) {
  test(`${family} · ${mode} · ${accent}: the icon accent keeps 3:1 non-text contrast on every ground an icon sits on`, () => {
    const e = evaluator(family, mode, accent);
    const black = '#000000';
    const backdrop = e.solid('bg-backdrop', black);
    const grounds = [['backdrop', backdrop], ...['bg-chrome', 'bg-app', 'bg-surface', 'bg-dialog', 'surface-raised', 'bg-surface-hover', 'tint-garnet'].map((n) => [n, e.solid(n, backdrop)])];
    // Icon tiles and search fields: the hover fill over the grounds they sit on (.plugin-card-icon,
    // the Settings search field).
    for (const [name, g] of [...grounds]) grounds.push([`fill-hover over ${name}`, e.solid('fill-hover', g)]);
    if (family === 'glass') {
      const page = e.solid('bg-app', black);
      const peak = over(e.color('var(--md-primary)').rgb, parseFloat(e.v['glass-wash-a']) / 100, page);
      for (const pane of ['glass-pane', 'glass-pane-strong', 'glass-window', 'glass-menu']) grounds.push([`${pane} over the wash`, e.solid(pane, saturate(peak, 1.8))]);
      grounds.push(['glass-pane over the bare page', e.solid('glass-pane', saturate(page, 1.8))]);
    }
    const accentColour = e.solid('icon-accent', black);
    for (const [name, g] of grounds) {
      const ratio = contrast(accentColour, g);
      assert.ok(ratio >= 3, `${family} ${mode} ${accent}: icon accent ${accentColour} on ${name} ${g} is ${ratio.toFixed(2)}:1`);
    }
  });
}
