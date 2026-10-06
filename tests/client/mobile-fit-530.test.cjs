'use strict';
// #530: on a phone nothing may be wider than the screen, and tier 2 is denser. The browser proof
// is qa/mobile-overflow-530.cjs (every surface at 320–430px, fails on main, passes after); this
// keeps the shared causes it found from coming back through the stylesheets, and keeps the
// density pass inside its limits: tier 2 only, spacing tokens only, 44px targets, and no radius
// or motion changes (those belong to #529).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = path.join(__dirname, '../../src/styles');
const read = (file) => fs.readFileSync(path.join(styles, file), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const TIER2 = '@media (max-width: 767px), (max-height: 599px)';
// The #530 section of a stylesheet: from its heading comment to the end of the file.
const section = (file, heading) => {
  const css = read(file), at = css.indexOf(heading);
  assert.ok(at >= 0, `${file} has the "${heading}" section`);
  return strip(css.slice(css.lastIndexOf('/*', at)));
};
const fit = section('phone.css', 'Everything fits the viewport (#530)');
const density = section('space-tiers.css', 'Tier 2, #530: denser phone layouts');
const declarations = (css) => [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map(([, property, value]) => [property, value.trim()]);

test('long words break instead of pushing past their box, without moving what fits', () => {
  // break-word, not anywhere: it does not lower min-content, so no layout that fits today changes.
  assert.match(fit, /:where\([^)]*\bh2\b[^)]*\bp\b[^)]*\)\s*\{\s*overflow-wrap:\s*break-word;\s*\}/);
});

test('the drawer’s Recent chats header stretches instead of width: 100% plus margins', () => {
  assert.match(fit, /\.sidebar \.spaces > \.section-toggle \{ width: auto; align-self: stretch; \}/);
});

test('sidebar titles are capped at their row and end in an ellipsis until the marquee runs', () => {
  assert.match(fit, /\.sidebar \.sidebar-label-text \{[^}]*max-width: 100%;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
  assert.match(fit, /\.sidebar-label\.is-overflowing \.sidebar-label-text \{ max-width: none; overflow: visible; \}/);
});

test('grids that overflowed use minmax(0, 1fr) tracks', () => {
  for (const selector of ['.tool-catalogue-main', '.identity-colors', '.identity-icons']) {
    assert.match(fit, new RegExp(`\\${selector} \\{ grid-template-columns: [^;]*minmax\\(0, 1fr\\)`), selector);
  }
});

test('the #530 fit rules never use 100vw or negative margins', () => {
  assert.doesNotMatch(fit, /100vw/);
  for (const [property, value] of declarations(fit)) if (/^margin/.test(property)) assert.doesNotMatch(value, /^-|calc\(\s*-|\*\s*-1/, `${property}: ${value}`);
});

test('density lives in tier 2 only, so tier 0 is unchanged', () => {
  const after = density;
  // Everything after the heading is one tier-2 block.
  assert.ok(after.trimStart().startsWith(TIER2), 'the section is a single tier-2 media block');
  let depth = 0, closed = -1;
  for (let i = after.indexOf('{'); i < after.length; i++) {
    if (after[i] === '{') depth++;
    else if (after[i] === '}' && --depth === 0) { closed = i; break; }
  }
  assert.equal(after.slice(closed + 1).trim(), '', 'no rule after the tier-2 block');
});

test('density uses the spacing tokens and never shrinks a target below 44px', () => {
  for (const [property, value] of declarations(density)) {
    if (/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(property)) {
      assert.match(value, /^(0|(calc\()?var\(--space-\d+\)[^;]*|var\(--space-\d+\) var\(--space-\d+\))$/, `${property}: ${value} uses a --space token`);
    }
    if (property === 'min-height' || property === 'height') assert.ok(parseFloat(value) >= 44 || /var\(/.test(value), `${property}: ${value}`);
  }
});

test('density matches the Compact density steps in tokens.css', () => {
  const tokens = read('tokens.css'), start = tokens.indexOf(":root[data-density='compact'] {");
  const compact = tokens.slice(start, tokens.indexOf('}', start));
  const root = density.match(/:root \{([^}]*)\}/);
  assert.ok(root, 'tier 2 sets the spacing roles on :root');
  const names = [...compact.matchAll(/(--[\w-]+):\s*([^;]+);/g)];
  assert.ok(names.length >= 5);
  for (const [, name, value] of names) assert.match(root[1], new RegExp(`${name}:\\s*${value.replace(/[()]/g, '\\$&')};`), `${name} matches Compact`);
  assert.doesNotMatch(root[1], /--group-inset-inline/, 'the inline inset never shrinks');
});

test('#530 changes layout, overflow, sizing and spacing only: no radius or motion properties', () => {
  for (const [property] of [...declarations(fit), ...declarations(density)]) {
    assert.doesNotMatch(property, /radius|transition|animation/, `${property} belongs to #529`);
  }
});
