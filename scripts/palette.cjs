#!/usr/bin/env node
'use strict';
// The noevia palette: Material 3 tonal ramps with Ramps Studio-style hue drift.
// A tone is CIELAB L* (as in M3's HCT), so tone 40 on any ramp has the same lightness and
// the role contrast holds across hues. Each ramp drifts in hue from its dark end to its light
// end (shadows cooler, highlights warmer), which is the Ramps character; chroma peaks mid-ramp
// and is clipped into sRGB. Run `node scripts/palette.cjs` to print the role blocks that
// src/styles/tokens.css carries; tests/theme-contrast.test.cjs re-derives nothing, it measures.

// Hue at tone 0 and tone 100, peak chroma. Hues are CIELAB LCh degrees.
const RAMPS = {
  primary:   { h0: 292, h1: 300, c: 52 },  // dusk iris: blue-violet shadows, lilac highlights
  secondary: { h0: 268, h1: 276, c: 16 },  // slate periwinkle: selected rows, quiet chips
  tertiary:  { h0: 48,  h1: 70,  c: 44 },  // apricot: model and inference identity
  neutral:   { h0: 284, h1: 292, c: 5, floor: 0.6 },   // violet-tinted grey structure
  neutralVariant: { h0: 282, h1: 290, c: 10, floor: 0.6 },
  error:     { h0: 24,  h1: 32,  c: 62 },
  success:   { h0: 158, h1: 150, c: 42 },  // connected / online
  warning:   { h0: 72,  h1: 88,  c: 58 },
  info:      { h0: 240, h1: 236, c: 36 },  // remote
};

function labToXyz(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  return [0.95047 * f(fx), 1 * f(fy), 1.08883 * f(fz)];
}
function xyzToRgb([x, y, z]) {
  const lin = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
  return lin.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}
const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
function lch(L, C, H) {
  // Reduce chroma until the colour fits sRGB, keeping tone and hue exact.
  for (let step = Math.ceil(C / 0.25); step >= 0; step -= 1) {
    const c = step * 0.25;
    const rgb = xyzToRgb(labToXyz(L, c * Math.cos((H * Math.PI) / 180), c * Math.sin((H * Math.PI) / 180)));
    if (inGamut(rgb)) return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}
function tone(name, t, ramps = RAMPS) {
  const r = ramps[name];
  const hue = r.h0 + (r.h1 - r.h0) * (t / 100);
  // Chroma fades toward black and white so the ends stay clean.
  const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, t / 100)) ** 0.9);
  return lch(t, r.c * Math.max(r.floor ?? 0.18, envelope), hue);
}

// Material 3 role → tone, per mode. App-specific status roles follow the same pattern.
const ROLES = {
  light: {
    primary: ['primary', 40], 'on-primary': ['primary', 100], 'primary-container': ['primary', 90], 'on-primary-container': ['primary', 25],
    secondary: ['secondary', 40], 'on-secondary': ['secondary', 100], 'secondary-container': ['secondary', 90], 'on-secondary-container': ['secondary', 25],
    tertiary: ['tertiary', 40], 'on-tertiary': ['tertiary', 100], 'tertiary-container': ['tertiary', 90], 'on-tertiary-container': ['tertiary', 25],
    error: ['error', 40], 'on-error': ['error', 100], 'error-container': ['error', 90], 'on-error-container': ['error', 25],
    success: ['success', 38], 'success-container': ['success', 90], 'on-success-container': ['success', 22],
    warning: ['warning', 40], 'warning-container': ['warning', 90], 'on-warning-container': ['warning', 22],
    info: ['info', 40], 'info-container': ['info', 90], 'on-info-container': ['info', 22],
    surface: ['neutral', 98], 'surface-dim': ['neutral', 88], 'surface-bright': ['neutral', 99],
    'surface-container-lowest': ['neutral', 100], 'surface-container-low': ['neutral', 96], 'surface-container': ['neutral', 94],
    'surface-container-high': ['neutral', 92], 'surface-container-highest': ['neutral', 90],
    'on-surface': ['neutral', 10], 'on-surface-variant': ['neutralVariant', 32],
    outline: ['neutralVariant', 50], 'outline-variant': ['neutralVariant', 84],
    'inverse-surface': ['neutral', 20], 'inverse-on-surface': ['neutral', 95], 'inverse-primary': ['primary', 80],
  },
  dark: {
    primary: ['primary', 80], 'on-primary': ['primary', 18], 'primary-container': ['primary', 30], 'on-primary-container': ['primary', 92],
    secondary: ['secondary', 80], 'on-secondary': ['secondary', 20], 'secondary-container': ['secondary', 28], 'on-secondary-container': ['secondary', 92],
    tertiary: ['tertiary', 80], 'on-tertiary': ['tertiary', 20], 'tertiary-container': ['tertiary', 30], 'on-tertiary-container': ['tertiary', 92],
    error: ['error', 80], 'on-error': ['error', 20], 'error-container': ['error', 30], 'on-error-container': ['error', 92],
    success: ['success', 80], 'success-container': ['success', 26], 'on-success-container': ['success', 92],
    warning: ['warning', 82], 'warning-container': ['warning', 28], 'on-warning-container': ['warning', 92],
    info: ['info', 80], 'info-container': ['info', 28], 'on-info-container': ['info', 92],
    surface: ['neutral', 7], 'surface-dim': ['neutral', 7], 'surface-bright': ['neutral', 24],
    'surface-container-lowest': ['neutral', 4], 'surface-container-low': ['neutral', 10], 'surface-container': ['neutral', 12],
    'surface-container-high': ['neutral', 17], 'surface-container-highest': ['neutral', 22],
    'on-surface': ['neutral', 92], 'on-surface-variant': ['neutralVariant', 78],
    outline: ['neutralVariant', 60], 'outline-variant': ['neutralVariant', 30],
    'inverse-surface': ['neutral', 90], 'inverse-on-surface': ['neutral', 20], 'inverse-primary': ['primary', 40],
  },
};

// Accent palettes (restored at the user's request, 2026-09-18). Each one re-hues the
// accent and neutral ramps and keeps every tone, so the role contrast the tests measure
// holds whichever one is chosen. `iris` IS the default noevia ramp set above, so it has
// no override block: choosing it means falling through to :root.
const PALETTES = {
  iris: {},
  warm: {
    primary: { h0: 52, h1: 74, c: 52 },
    secondary: { h0: 46, h1: 66, c: 16 },
    tertiary: { h0: 10, h1: 26, c: 46 },
    neutral: { h0: 58, h1: 70, c: 5, floor: 0.6 },
    neutralVariant: { h0: 56, h1: 68, c: 10, floor: 0.6 },
  },
  cool: {
    primary: { h0: 246, h1: 258, c: 50 },
    secondary: { h0: 238, h1: 250, c: 16 },
    tertiary: { h0: 188, h1: 202, c: 40 },
    neutral: { h0: 246, h1: 258, c: 5, floor: 0.6 },
    neutralVariant: { h0: 244, h1: 256, c: 10, floor: 0.6 },
  },
  neutral: {
    primary: { h0: 278, h1: 290, c: 14 },
    secondary: { h0: 276, h1: 288, c: 8 },
    tertiary: { h0: 60, h1: 78, c: 14 },
    neutral: { h0: 280, h1: 292, c: 3, floor: 0.6 },
    neutralVariant: { h0: 278, h1: 290, c: 6, floor: 0.6 },
  },
  sage: {
    primary: { h0: 136, h1: 152, c: 44 },
    secondary: { h0: 142, h1: 158, c: 14 },
    tertiary: { h0: 58, h1: 80, c: 38 },
    neutral: { h0: 146, h1: 160, c: 4, floor: 0.6 },
    neutralVariant: { h0: 144, h1: 158, c: 8, floor: 0.6 },
  },
};
const PALETTE_NAMES = Object.keys(PALETTES);

const rampsFor = (name) => ({ ...RAMPS, ...(PALETTES[name] || {}) });

function roles(mode, name = 'iris') {
  const ramps = rampsFor(name);
  return Object.fromEntries(Object.entries(ROLES[mode]).map(([role, [ramp, t]]) => [role, tone(ramp, t, ramps)]));
}

module.exports = { RAMPS, ROLES, PALETTES, PALETTE_NAMES, tone, roles, rampsFor };

/** The two generated blocks, as they sit between the markers in tokens.css. */
function block() {
  const lines = (mode, name) => Object.entries(roles(mode, name)).map(([role, hex]) => `  --md-${role}: ${hex};`).join('\n');
  const base = `:root, [data-theme='dark'] {\n${lines('dark', 'iris')}\n  color-scheme: dark;\n}\n[data-theme='light'] {\n${lines('light', 'iris')}\n  color-scheme: light;\n}`;
  // Two selector classes each, so a palette always beats the :root / [data-theme] default
  // whichever order the file ends up in.
  const extra = PALETTE_NAMES.filter((name) => name !== 'iris').map((name) =>
    `[data-palette='${name}']:not([data-theme='light']) {\n${lines('dark', name)}\n}\n` +
    `[data-palette='${name}'][data-theme='light'] {\n${lines('light', name)}\n}`).join('\n');
  return `${base}\n${extra}`;
}
const BEGIN = '/* palette:begin — generated by scripts/palette.cjs --write; do not edit by hand */';
const END = '/* palette:end */';
module.exports.block = block;
module.exports.markers = { BEGIN, END };

if (require.main === module && process.argv.includes('--write')) {
  const fs = require('node:fs');
  const file = require('node:path').join(__dirname, '../src/styles/tokens.css');
  const css = fs.readFileSync(file, 'utf8');
  const start = css.indexOf(BEGIN), stop = css.indexOf(END);
  if (start < 0 || stop < start) throw Error('tokens.css has no palette markers');
  fs.writeFileSync(file, css.slice(0, start + BEGIN.length) + '\n' + block() + '\n' + css.slice(stop));
  console.log('tokens.css palette block updated');
} else if (require.main === module) {
  for (const mode of ['light', 'dark']) {
    console.log(`/* ${mode} */`);
    for (const [role, hex] of Object.entries(roles(mode))) console.log(`  --md-${role}: ${hex};`);
  }
  if (process.argv.includes('--ramps')) for (const name of Object.keys(RAMPS)) console.log(name, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99].map((t) => tone(name, t)).join(' '));
}
