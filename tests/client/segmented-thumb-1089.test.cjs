'use strict';
// #1089: SegmentedControl (and ModeSwitch, PermissionControl) draw their chosen-option thumb as a
// `.glass-thumb` span whose geometry useSegmentThumb writes into --thumb-x/-y/-w/-h on the track.
// No rule positioned it, so the thumb sat in normal flow and the chosen option showed no thumb.
// This pins the CSS contract: the track is the positioning context, the thumb is absolutely placed
// and moved by those variables, and the option labels sit above it.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

// Every rule in a stylesheet whose selector mentions `needle`, as { selector, body }.
function rulesMentioning(css, needle) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) if (m[1].includes(needle)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

test('the segmented track is the positioning context for its thumb', () => {
  const rules = rulesMentioning(read('src/styles/system/components.css'), '.glass-seg');
  assert.ok(rules.some((r) => /position:\s*relative/.test(r.body) && /\.glass-seg\b/.test(r.selector) && !/\.glass-thumb/.test(r.selector)),
    '.glass-seg must be position: relative so offsetLeft/offsetTop from useSegmentThumb are measured from the track');
});

test('the thumb is absolutely placed and driven by the variables useSegmentThumb sets', () => {
  const rules = rulesMentioning(read('src/styles/system/components.css'), '.glass-thumb');
  const thumb = rules.filter((r) => /\.glass-seg\s*>\s*\.glass-thumb/.test(r.selector)).map((r) => r.body).join('\n');
  assert.match(thumb, /position:\s*absolute/, 'the thumb must leave normal flow');
  assert.match(thumb, /left:\s*0/);
  assert.match(thumb, /top:\s*0/);
  assert.match(thumb, /width:\s*var\(--thumb-w/);
  assert.match(thumb, /height:\s*var\(--thumb-h/);
  assert.match(thumb, /transform:\s*translate\(var\(--thumb-x/, 'the thumb must slide to the chosen option');
  assert.match(thumb, /pointer-events:\s*none/, 'the thumb must not swallow clicks meant for the options');
});

test('the options stay above the thumb so their labels remain readable and clickable', () => {
  const rules = rulesMentioning(read('src/styles/system/components.css'), '.glass-seg > button');
  assert.ok(rules.some((r) => /position:\s*relative/.test(r.body) && /z-index:\s*1/.test(r.body)),
    'the option buttons need position: relative and a z-index above the thumb');
});

test('the variables the thumb reads are the ones useSegmentThumb writes', () => {
  const seg = read('src/components/SegmentedControl.tsx');
  for (const v of ['--thumb-w', '--thumb-x', '--thumb-y', '--thumb-h']) assert.match(seg, new RegExp(v));
});
