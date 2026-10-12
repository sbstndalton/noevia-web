'use strict';
// #1540: in Settings > Models & routing the summary card's row labels were squeezed by their values:
// "Auto routing" showed as "Auto ro...". The label keeps its natural width and the value takes the
// rest of the row. Pure stylesheet check (the layout itself is not measured here: no browser in this
// batch), so it pins the rules that decide it and that the summary uses those classes.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'src/styles/noevia.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const appCss = fs.readFileSync(path.join(root, 'src/styles/app.css'), 'utf8');
const summary = fs.readFileSync(path.join(root, 'src/components/models/ModelsSummary.tsx'), 'utf8');

test('the summary row label is not allowed to shrink below its text', () => {
  // The base row label is the one that truncates (overflow hidden, ellipsis): the summary must
  // override its flex basis so it keeps its natural width.
  assert.match(appCss, /\.model-name \{[^}]*text-overflow: ellipsis;[^}]*\}/, 'the base label truncates, which is why this override matters');
  const rule = css.match(/\.mm-summary \.model-name \{([^}]*)\}/);
  assert.ok(rule, 'noevia.css has a .mm-summary .model-name rule');
  assert.match(rule[1], /flex: 0 0 auto/);
});

test('the value keeps wrapping inside its own column, as before', () => {
  const rule = css.match(/\.mm-summary \.model-role \{([^}]*)\}/);
  assert.ok(rule && /flex-shrink: 1/.test(rule[1]) && /white-space: normal/.test(rule[1]));
});

test('the Models & routing summary renders its routing row with the label and value classes', () => {
  assert.match(summary, /<div className="model-row"><span className="model-name">\{t\('models\.autoRouting'\)\}<\/span><span className="model-role">\{routing\}<\/span><\/div>/);
});
