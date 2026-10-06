const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const palette = require('../../scripts/palette.cjs');
const css = readFileSync(join(__dirname, '../../src/styles/tokens.css'), 'utf8');

function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

/** Custom properties as the browser resolves them for one mode and accent palette
 *  (top-level rules, file order; @media skipped). A palette block is two selector
 *  classes, so it lands after the defaults exactly as the browser would apply it. */
function tokens(mode, accent = 'iris') {
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const applies = (selector) => selector.split(',').map(s => s.trim()).some(s =>
    s === ':root' ? true
      : s === `[data-theme='${mode}']` || s === `:root[data-theme='${mode}']` ? true
      : s === `[data-palette='${accent}']:not([data-theme='light'])` ? mode === 'dark'
      : s === `[data-palette='${accent}'][data-theme='light']` ? mode === 'light'
      : /^\[data-palette=/.test(s) ? false
      : s === ":root:not([data-theme='light'])" ? mode === 'dark' : false);
  const values = {};
  for (const [, selector, body] of top.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!applies(selector.replace(/\/\*[\s\S]*?\*\//g, ''))) continue;
    for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) values[name] = value.trim();
  }
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) throw Error(`cycle at --${name}`);
    const value = values[name];
    const ref = value && value.match(/^var\(--([\w-]+)\)$/);
    return ref ? resolve(ref[1], new Set([...seen, name])) : value;
  };
  return new Proxy({}, { get: (_, name) => resolve(name) });
}

test('tokens.css carries exactly the palette the generator prints', () => {
  const { BEGIN, END } = palette.markers;
  assert.equal(css.slice(css.indexOf(BEGIN) + BEGIN.length, css.indexOf(END)).trim(), palette.block().trim(), 'run node scripts/palette.cjs --write');
});

for (const mode of ['dark', 'light']) for (const accent of palette.PALETTE_NAMES) test(`${mode} · ${accent}: text, status, actions and controls meet contrast on every ground`, () => {
  const t = tokens(mode, accent);
  for (const ground of ['bg-canvas', 'bg-surface', 'bg-chrome', 'bg-app', 'bg-surface-hover']) {
    assert.match(t[ground], /^#[\da-f]{6}$/i, `${mode} ${ground} resolves to a colour`);
    assert.ok(contrast(t['text-primary'], t[ground]) >= 7, `${mode} text-primary/${ground}: ${contrast(t['text-primary'], t[ground]).toFixed(2)}`);
    for (const fg of ['text-secondary', 'accent-text', 'good', 'status-danger', 'status-warning', 'status-remote', 'status-inference', 'status-local']) {
      const ratio = contrast(t[fg], t[ground]);
      assert.ok(ratio >= 4.5, `${mode} ${accent} ${fg}/${ground}: ${ratio.toFixed(2)}`);
    }
    for (const fg of ['focus-ring', 'control-border', 'status-offline']) assert.ok(contrast(t[fg], t[ground]) >= 3, `${mode} ${fg}/${ground}`);
  }
  for (const [fg, bg, min] of [
    ['on-accent', 'accent-garnet', 4.5], ['on-tint', 'tint-garnet', 7], ['accent-text', 'tint-garnet', 4.5],
    ['on-selected', 'selected', 7], ['text-primary', 'selected', 7], ['on-danger', 'danger', 4.5],
    ['md-on-success-container', 'md-success-container', 7], ['md-on-warning-container', 'md-warning-container', 7],
    ['md-on-error-container', 'md-error-container', 7], ['md-on-info-container', 'md-info-container', 7],
    ['md-on-tertiary-container', 'md-tertiary-container', 7], ['md-inverse-on-surface', 'md-inverse-surface', 7],
  ]) {
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(ratio >= min, `${mode} ${accent} ${fg}/${bg}: ${ratio.toFixed(2)}`);
  }
});

test('every Material 3 role exists in both modes, for every accent palette', () => {
  for (const mode of ['dark', 'light']) for (const accent of palette.PALETTE_NAMES) for (const role of Object.keys(palette.ROLES[mode])) {
    assert.match(tokens(mode, accent)[`md-${role}`], /^#[\da-f]{6}$/i, `${mode} ${accent} --md-${role}`);
  }
});
