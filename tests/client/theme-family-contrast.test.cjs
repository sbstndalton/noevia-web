'use strict';
// #951: every theme family (system/themes.css) over the one token layer (system/tokens.css), in
// light and dark, for every accent: body text keeps AA (primary 7:1, secondary/accent 4.5:1) and
// the focus ring stays visible (3:1) on each ground a family paints — the backdrop, the sidebar
// and main tiles, cards and the dialog — and, for Glass, on its translucent panes composited over
// the accent wash at their real opacity (the wash peak is the worst case for text).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
const tokens = strip(fs.readFileSync(path.join(__dirname, '../../src/styles/system/tokens.css'), 'utf8'));
const themes = strip(fs.readFileSync(path.join(__dirname, '../../src/styles/system/themes.css'), 'utf8'));
const ACCENTS = ['iris', 'warm', 'cool', 'neutral', 'sage'];

const hex = (h) => h.slice(1).match(/../g).map((v) => parseInt(v, 16));
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = (h) => { const c = hex(h).map((v) => v / 255).map((v) => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const over = (rgb, a, bg) => toHex(rgb.map((c, i) => c * a + hex(bg)[i] * (1 - a)));

/** Custom properties as the browser resolves them on <html> for one family, mode and accent. */
function values(family, mode, accent) {
  const applies = (s) => s === ':root' || s === '.theme-scope'
    || s === `[data-theme='${mode}']`
    || (s === ":root:not([data-theme='light'])" || s === ".theme-scope:not([data-theme='light'])") && mode === 'dark'
    || s === `[data-palette='${accent}']:not([data-theme='light'])` && mode === 'dark'
    || s === `[data-palette='${accent}'][data-theme='light']` && mode === 'light'
    || s === `[data-family='${family}']`
    || s === `[data-family='${family}']:not([data-theme='light'])` && mode === 'dark'
    || s === `[data-family='${family}'][data-theme='light']` && mode === 'light';
  const out = {};
  for (const css of [tokens, themes]) for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selector.split(',').map((s) => s.trim()).some(applies)) continue;
    for (const [, name, v] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[name] = v.trim();
  }
  return out;
}

function evaluator(family, mode, accent) {
  const v = values(family, mode, accent);
  /** A colour as { rgb, a }. */
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

/** The strongest point of Glass's wash: primary at --glass-wash-a over the page. */
function washPeak(e) {
  const page = e.solid('bg-app', '#000000');
  const pct = parseFloat(e.v['glass-wash-a']) / 100;
  return over(e.color('var(--md-primary)').rgb, pct, page);
}
/** CSS saturate(s) (Filter Effects feColorMatrix), sRGB, clamped. */
function saturate(color, s) {
  const [r, g, b] = hex(color);
  const m = [[.213 + .787 * s, .715 - .715 * s, .072 - .072 * s], [.213 - .213 * s, .715 + .285 * s, .072 - .072 * s], [.213 - .213 * s, .715 - .715 * s, .072 + .928 * s]];
  return toHex(m.map(([x, y, z]) => x * r + y * g + z * b));
}

test('the Glass optics this test models match themes.css', () => {
  assert.match(themes, /backdrop-filter: blur\(var\(--glass-blur\)\) saturate\(1\.8\)/);
  assert.match(themes, /radial-gradient\(60% 55% at 8% 4%, color-mix\(in srgb, var\(--md-primary\) var\(--glass-wash-a\), transparent\)/);
});

for (const family of ['editorial', 'contemporary', 'glass']) for (const mode of ['light', 'dark']) for (const accent of ACCENTS) {
  test(`${family} · ${mode} · ${accent}: body text keeps AA and the focus ring stays visible on every ground`, () => {
    const e = evaluator(family, mode, accent);
    const black = '#000000';
    const backdrop = e.solid('bg-backdrop', black);
    const grounds = [['backdrop', backdrop], ...['bg-chrome', 'bg-app', 'bg-surface', 'bg-dialog', 'surface-raised'].map((n) => [n, e.solid(n, backdrop)])];
    if (family === 'glass') {
      const peak = washPeak(e);
      const behind = saturate(peak, 1.8);
      for (const pane of ['glass-pane', 'glass-pane-strong', 'glass-window']) grounds.push([`${pane} over the wash`, e.solid(pane, behind)]);
      grounds.push(['glass-pane over the bare page', e.solid('glass-pane', saturate(e.solid('bg-app', black), 1.8))]);
    }
    const text = e.solid('text-primary', black), secondary = e.solid('text-secondary', black), accentText = e.solid('accent-text', black), focus = e.solid('focus', black);
    for (const [name, g] of grounds) {
      assert.ok(contrast(text, g) >= 7, `${name} ${g}: text-primary ${contrast(text, g).toFixed(2)}`);
      assert.ok(contrast(secondary, g) >= 4.5, `${name} ${g}: text-secondary ${contrast(secondary, g).toFixed(2)}`);
      assert.ok(contrast(accentText, g) >= 4.5, `${name} ${g}: accent-text ${contrast(accentText, g).toFixed(2)}`);
      assert.ok(contrast(focus, g) >= 3, `${name} ${g}: focus ring ${contrast(focus, g).toFixed(2)}`);
    }
  });
}
