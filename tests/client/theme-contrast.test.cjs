const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
// #951: one hand-authored token layer (no generator); the accents recolour the accent roles only.
const css = readFileSync(join(__dirname, '../../src/styles/system/tokens.css'), 'utf8');
const ACCENTS = ['iris', 'warm', 'cool', 'neutral', 'sage'];

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

for (const mode of ['dark', 'light']) for (const accent of ACCENTS) test(`${mode} · ${accent}: text, status, actions and controls meet contrast on every ground`, () => {
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
  const roles = [...css.slice(0, css.indexOf("[data-theme='light'] {")).matchAll(/--md-([\w-]+):/g)].map((m) => m[1]);
  assert.ok(roles.length >= 40, `${roles.length} roles`);
  for (const mode of ['dark', 'light']) for (const accent of ACCENTS) for (const role of roles) {
    assert.match(tokens(mode, accent)[`md-${role}`], /^#[\da-f]{6}$/i, `${mode} ${accent} --md-${role}`);
  }
});

test('surfaces are one neutral ladder: no accent palette changes a surface or text role', () => {
  for (const mode of ['dark', 'light']) for (const accent of ACCENTS) for (const role of ['md-surface', 'md-surface-container-low', 'md-surface-container', 'md-on-surface', 'md-on-surface-variant', 'md-outline']) {
    assert.equal(tokens(mode, accent)[role], tokens(mode, 'iris')[role], `${mode} ${accent} ${role}`);
  }
  // The Claude ladder (#951): page 21, raised 26, card 32 in dark; bg-100 page in light.
  assert.equal(tokens('dark')['md-surface'], '#151515');
  assert.equal(tokens('dark')['md-surface-container-low'], '#1a1a19');
  assert.equal(tokens('dark')['md-surface-container'], '#20201f');
  assert.equal(tokens('dark')['md-on-surface'], '#f0efec');
  assert.equal(tokens('light')['md-surface'], '#faf9f5');
});
