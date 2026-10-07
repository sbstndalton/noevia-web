'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Spacing rhythm for Settings (Apple grouped lists). A group's rows always keep their inline
// inset, read from one token, whatever surface a family paints behind them. Settings →
// Appearance (#371) once stripped its rows to `padding: 20px 0` for a borderless look; Contemporary and
// Glass then filled the group and every title, description and swatch sat flush against the
// fill's left edge. The browser suite qa/spacing-rhythm.cjs measures the rendered result; this
// keeps the stylesheet from reintroducing it.
const root = path.join(__dirname, '../../src/styles');
const sheets = fs.readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.css'));
const rules = (file) => [...fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), declarations: body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]) }));
const tokenBlock = (css, selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `tokens.css declares ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};
const token = (block, name) => (block.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1];

test('rows in a Settings group take their inline inset from --group-inset-inline', () => {
  for (const file of sheets) for (const { selector, declarations } of rules(file)) {
    if (!/\.settings-stage/.test(selector) || !/\.(set-row|row)(?![-\w])/.test(selector)) continue;
    for (const [property, value] of declarations) {
      if (property === 'padding') {
        const parts = value.split(/\s+(?![^(]*\))/);
        const inline = parts.length === 1 ? parts[0] : parts[1];
        assert.match(inline, /var\(--group-inset-inline\)/, `${file}: ${selector} sets padding: ${value}; rows keep --group-inset-inline`);
      }
      if (/^padding-(inline|left|right|inline-start|inline-end)$/.test(property)) {
        assert.match(value, /var\(--group-inset-inline\)/, `${file}: ${selector} sets ${property}: ${value}`);
      }
    }
  }
});

test('no single Settings section strips the shared group surface', () => {
  // A section-scoped rule that removes the group's border and fill is how the flat, flush
  // Appearance list happened; a category that wants a different container needs its own class.
  for (const file of sheets) for (const { selector, declarations } of rules(file)) {
    if (!/-section[^,{]*>\s*\.set-rows|-section\s+\.set-rows/.test(selector)) continue;
    const props = Object.fromEntries(declarations);
    assert.ok(!(props.border === '0' || props.border === 'none'), `${file}: ${selector} removes the group border`);
  }
});

test('the spacing roles exist, and compact density steps the vertical ones down only', () => {
  const css = fs.readFileSync(path.join(root, 'system/tokens.css'), 'utf8');
  const base = tokenBlock(css, ':root, .theme-scope');
  const compact = tokenBlock(css, ":root[data-density='compact']");
  for (const name of ['--group-inset-block', '--group-inset-inline', '--group-row-min', '--settings-title-gap', '--settings-group-gap', '--settings-content-gap', '--settings-heading-gap']) {
    assert.match(token(base, name) || '', /^(?:var\(--space-\d+\)|calc\(var\(--space-\d+\) \+ var\(--space-\d+\)\))$/, `${name} is a step on the 4pt --space-* scale`);
  }
  for (const name of ['--group-inset-block', '--group-row-min', '--settings-group-gap']) {
    assert.ok(token(compact, name), `compact density sets ${name}`);
    assert.notEqual(token(compact, name), token(base, name), `compact ${name} differs from comfortable`);
  }
  assert.equal(token(compact, '--group-inset-inline'), undefined, 'compact density never trims the inline inset');
});

test('Settings navigation draws its focus ring inside the row, where the list cannot clip it', () => {
  const found = sheets.flatMap((file) => rules(file)).find(({ selector }) => /\.settings-navigation nav button:focus-visible/.test(selector));
  assert.ok(found, 'a focus rule for Settings navigation rows exists');
  const offset = Object.fromEntries(found.declarations)['outline-offset'];
  assert.match(offset || '', /^-\d/, `outline-offset is negative (got ${offset})`);
});
