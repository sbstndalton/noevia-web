// #1565: in the Code sidebar, the empty Tasks text ("Your coding tasks will appear here.") started about
// 8px left of its heading. The section heading is inset 10px by its label rule; the empty-state text
// (a .side-hint inside the Code history) had only 2px, so the two left edges differed. The hint now takes
// the same 10px inset, with no padding of its own on that side. Layout is not measurable from Node, so this
// reads the stylesheet: the label's inset and the hint's inset must match.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../src/styles/phone.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const labelCss = fs.readFileSync(path.join(__dirname, '../../src/styles/shell-v2.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleFor(text, selector) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let found = null;
  while ((m = re.exec(text))) {
    const selectors = m[1].split(',').map((x) => x.replace(/\s+/g, ' ').trim());
    if (selectors.includes(selector)) found = m[2];
  }
  return found;
}

test('the Code sidebar empty-state hint is inset 10px, the same as the section heading it sits under', () => {
  const hint = ruleFor(css, '.app .sidebar.pane .coding-history .side-hint');
  assert.ok(hint, 'the coding-history side-hint rule is gone');
  assert.match(hint, /margin:\s*0\s+10px/, 'the hint is not inset 10px like the heading');
  assert.doesNotMatch(hint, /padding:\s*2px\s+2px/, 'the hint still carries the 2px side padding that pulled it left');
});

test('the section heading it is aligned to is inset 10px', () => {
  const label = ruleFor(labelCss, '.app .sidebar.pane .section-label') || ruleFor(labelCss, '.app .sidebar.pane .sidebar-history .section-label') || '';
  assert.match(label, /margin:\s*var\(--space-5\)\s+10px/, 'the section label inset changed; align the hint to it again');
});

test('the Tasks empty state in the Code sidebar is the hint that uses the coding-history class', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '../../src/components/Sidebar.tsx'), 'utf8');
  assert.match(sidebar, /<div className=\{'sidebar-history coding-history'\}|className="sidebar-history coding-history"/, 'the Code history no longer carries coding-history');
  assert.match(sidebar, /<p className="side-hint">\{t\('sidebar\.tasksEmpty'\)\}<\/p>/, 'the Tasks empty state is no longer a side-hint');
});
