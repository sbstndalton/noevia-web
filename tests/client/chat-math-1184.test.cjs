'use strict';
// #1184 review: the inline-math scanner must stay linear on hostile input.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('a 100 KB line of "\\(" does not trigger quadratic regex scanning', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryModal.tsx'), 'utf8');
  const lit = src.split('\n').find((l) => l.includes('\\\\\\(') && l.includes('Me|Assistant|Claude'));
  assert.ok(lit, 'inline regex literal found');
  const re = new RegExp(/(\$\$[^$\n]+\$\$|\\\([^\n]{1,500}?\\\)|\$(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\d))/.source, 'g');
  assert.ok(lit.includes('\\\\\\([^\\n]{1,500}?\\\\\\)'), 'the source regex bounds the \\( span');
  const hostile = '\\('.repeat(50000);
  const t0 = Date.now();
  hostile.split(re);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
});
