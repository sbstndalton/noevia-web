// #510: decluttering is driven by space, in three tiers. The stylesheet only works if it loads
// after the family overrides it lightens, its queries must match src/space-tier.ts, and nothing
// may hide in tier 0. Browser proof lives in qa/phone-declutter-510.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '../../src');
const css = fs.readFileSync(path.join(src, 'styles/space-tiers.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ts = fs.readFileSync(path.join(src, 'space-tier.ts'), 'utf8');
const TIER1 = '(max-width: 1023px), (max-height: 759px)';
const TIER2 = '(max-width: 767px), (max-height: 599px)';

test('space-tiers.css is the last stylesheet main.tsx imports', () => {
  const imports = [...fs.readFileSync(path.join(src, 'main.tsx'), 'utf8').matchAll(/import '\.\/styles\/([\w-]+\.css)';/g)].map(m => m[1]);
  assert.equal(imports.at(-1), 'space-tiers.css');
  assert.ok(imports.indexOf('families.css') < imports.indexOf('space-tiers.css'));
});

test('the CSS tiers and the JS tiers use the same queries', () => {
  assert.ok(ts.includes(`SPACE_TIER1_QUERY = '${TIER1}'`));
  assert.ok(ts.includes(`SPACE_TIER2_QUERY = '${TIER2}'`));
  assert.ok(css.includes(`@media ${TIER1}`));
  assert.ok(css.includes(`@media ${TIER2}`));
  // phone.css's bottom-edge chat surface starts at the same tier 2.
  assert.ok(fs.readFileSync(path.join(src, 'styles/phone.css'), 'utf8').includes(`@media ${TIER2} {\n  .app .chat-workspace { display: flex;`));
});

test('nothing is hidden in tier 0 except the parts only tier 2 shows', () => {
  const blocks = []; let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) { blocks.push(css.slice(start, i + 1).trim()); start = i + 1; }
  }
  const shrinking = /^@media (\(max-width: \d+px\)|\(max-height: \d+px\))/;
  const tier2Only = /model-pill-short|reasoning-pill-icon|composer-browse-tools|composer-add-badge/;
  for (const block of blocks) {
    if (!/display:\s*none/.test(block) || shrinking.test(block)) continue;
    for (const rule of block.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)) {
      for (const selector of rule[1].replace(/@media[^{]*/, '').split(',')) assert.match(selector, tier2Only, `hidden in tier 0: ${selector.trim()}`);
    }
  }
});
