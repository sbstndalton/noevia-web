// #1557: on Customise → Skills → Discover, the card's title and description started at one x, the
// View chip at another and Add to project at a third, because the actions stacked under the text in
// a column that right-aligned them. A layout is not measurable from Node, so this is a source
// contract on the rule that fixes it: the card is a two-column grid whose second column is the title
// column, and the actions sit in that column in one row. It reads the stylesheet and the markup
// directly, so a later edit that drops the rule fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const css = fs.readFileSync(path.join(SRC, 'styles/phone.css'), 'utf8');
const view = fs.readFileSync(path.join(SRC, 'components/plugins/PluginsView.tsx'), 'utf8');

// The declarations of every rule whose selector list contains `selector` (exact, after whitespace trim).
function declarationsFor(selector) {
  const out = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(bare))) {
    const selectors = m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}

const CARD = '.plugin-card:has(> .plugin-card-actions):not(:has(.plugin-key-form))';

test('a Discover card is a two-column grid whose title column starts after the 36px icon', () => {
  const card = declarationsFor(CARD);
  assert.match(card, /display:\s*grid/, 'the card is not a grid, so its actions cannot share the title column');
  assert.match(card, /grid-template-columns:\s*36px\s+minmax\(0,\s*1fr\)/, 'the second column does not start after the 36px icon');
  assert.equal(declarationsFor(`${CARD} > .plugin-card-text`).match(/grid-column:\s*2/) !== null, true, 'the title is not in the title column');
  assert.equal(declarationsFor(`${CARD} > .plugin-card-icon`).match(/grid-column:\s*1/) !== null, true, 'the icon is not in the first column');
});

test('the actions sit in the title column, one row, so the View chip and Add to project share its left edge', () => {
  const actions = declarationsFor(`${CARD} > .plugin-card-actions`);
  assert.match(actions, /grid-column:\s*2/, 'the actions are not in the title column');
  assert.match(actions, /flex-direction:\s*row/, 'the actions are not one row');
  assert.match(actions, /justify-content:\s*flex-start/, 'the actions are not anchored to the title edge');
  assert.doesNotMatch(actions, /align-items:\s*flex-end/, 'the actions still right-align into their own column');
});

test('the rule leaves cards with a key form alone: their form keeps the full width it is designed for', () => {
  assert.match(css, /\.plugin-card:has\(\.plugin-key-form\) \.plugin-card-actions \{ flex-basis: 100%/, 'the key-form card rule moved; the :not exclusion must follow it');
  assert.ok(css.includes(':not(:has(.plugin-key-form))'), 'the new grid is not scoped away from key-form cards');
});

test('the Discover card markup keeps the icon, text and actions as direct children the rule targets', () => {
  const card = view.slice(view.indexOf('const card = (i: Item'), view.indexOf('return <section className="plugins-directory"'));
  assert.match(card, /<span className="plugin-card-icon">/);
  assert.match(card, /<span className="plugin-card-text">/);
  assert.match(card, /<span className="plugin-card-actions">/);
});
