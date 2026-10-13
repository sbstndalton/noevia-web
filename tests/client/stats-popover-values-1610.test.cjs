// #1610: the turn metrics popover (the "more" panel over the strip, when the strip is too narrow for every pair)
// set its label column to max-content, so the labels took most of the 360px panel and the value column was a
// sliver. Its values also had overflow-wrap: anywhere, so "Measuring…" broke as "Measurin / g…". The labels now
// share the width with the values, and a value breaks only between words. Checked as the CSS rules, which is
// what produces the layout; the rendered result was measured in headless Chrome (see the PR).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '../../src/styles/phone.css'), 'utf8');

function ruleBody(selector) {
  const start = CSS.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} rule exists`);
  return CSS.slice(start, CSS.indexOf('}', start) + 1);
}

test('#1610 the popover gives its value column the larger share, not max-content to the labels', () => {
  const panel = ruleBody('.stats-disclosure.is-wide.is-more-open .stats-details');
  assert.doesNotMatch(panel, /grid-template-columns:\s*max-content/, 'labels do not take their full width');
  assert.match(panel, /grid-template-columns:\s*minmax\(0,\s*2fr\)\s*minmax\(0,\s*3fr\)/, 'the value column is the wider one');
});

test('#1610 a label wraps inside its column: the wide row nowrap is inherited through display: contents', () => {
  const labels = ruleBody('.stats-disclosure.is-wide.is-more-open .stats-details dt');
  assert.match(labels, /white-space:\s*normal/, 'a long label (MTP acceptance) wraps instead of running into the value');
});

test('#1610 a popover value wraps at its spaces, and a long unbroken token wraps rather than running out of the panel', () => {
  const values = ruleBody('.stats-disclosure.is-wide.is-more-open .stats-details dd');
  assert.match(values, /overflow-wrap:\s*anywhere/, 'a token too long for its column breaks instead of clipping');
  assert.match(values, /white-space:\s*normal/, 'values still wrap at spaces');
  assert.match(values, /overflow:\s*visible/, 'nothing is hidden behind an overflow clip');
});
