'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Theme families (#249) change a component's colour, depth and shape, never its layout. The
// typeface, radius, elevation and motion of a family are tokens, declared once in themes.css;
// a component rule scoped to one family may not change size, spacing or font metrics, so
// switching family keeps every screen's layout and wrapping (the old Material 3 guarantee,
// now held for all three).
const root = path.join(__dirname, '../../src/styles');
const rules = (file) => [...fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), declarations: body.split(';').map(d => d.split(':')[0].trim()).filter(Boolean) }));

test('family-scoped component rules inherit shared geometry and font metrics', () => {
  const forbidden = /^(?:(?:min-|max-)?(?:width|height)|padding(?:-.+)?|margin(?:-.+)?|gap|font(?:-.+)?|letter-spacing|border(?:-(?:width|top|left|right|bottom))?|--font-ui|--font-display|--row-inset|--row-gap|--group-inset-(?:block|inline)|--group-row-min|--settings-[\w-]+-gap)$/;
  for (const file of fs.readdirSync(root).filter(name => name.endsWith('.css') && name !== 'themes.css')) {
    for (const { selector, declarations } of rules(file)) {
      if (!/data-family=/.test(selector)) continue;
      for (const property of declarations) assert.equal(forbidden.test(property), false, `${file}: ${selector} overrides ${property}`);
    }
  }
});

test('themes.css declares only tokens, for exactly the three families', () => {
  const seen = new Set();
  for (const { selector, declarations } of rules('themes.css')) {
    for (const [, family] of selector.matchAll(/data-family='(\w+)'/g)) seen.add(family);
    for (const property of declarations) assert.match(property, /^--/, `themes.css: ${selector} sets ${property}; families only set tokens`);
  }
  assert.deepEqual([...seen].sort(), ['contemporary', 'editorial', 'glass']);
});

test('every family defines a typeface pairing with a system fallback, and a shape and motion profile', () => {
  const css = fs.readFileSync(path.join(root, 'themes.css'), 'utf8');
  for (const family of ['editorial', 'contemporary', 'glass']) {
    const block = css.match(new RegExp(`\\[data-family='${family}'\\] \\{([^}]*)\\}`))[1];
    for (const token of ['--font-ui', '--font-display', '--display-weight', '--radius-control', '--radius-overlay', '--radius-surface', '--motion-quick', '--motion-considered']) {
      assert.match(block, new RegExp(`${token}:`), `${family} sets ${token}`);
    }
    for (const face of ['--font-ui', '--font-display']) {
      const stack = block.match(new RegExp(`${face}:\\s*([^;]+);`))[1];
      assert.match(stack, /(sans-serif|serif)\s*$/, `${family} ${face} ends in a generic family`);
      assert.ok(stack.split(',').length >= 3, `${family} ${face} has fallbacks`);
    }
    for (const mode of [`[data-family='${family}'][data-theme='light']`, `[data-family='${family}']:not([data-theme='light'])`]) {
      assert.ok(css.includes(mode + ' {'), `${family} has its own ${mode.includes(':not') ? 'dark' : 'light'} palette block`);
    }
  }
});
