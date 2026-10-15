// noevia#1721: motion.css's header states the rules every keyframe in the file follows. #1716 added a
// scroll-linked clip-path keyframe (side-new-underlap) without naming it as the exception, and the
// header still counted "these five" keyframes while the file held more. The header must not count
// them and must name every keyframe that animates something other than opacity or transform.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../src/styles/system/motion.css'), 'utf8');
const header = css.slice(0, css.indexOf('*/'));

test('motion.css header does not carry a stale keyframe count', () => {
  assert.doesNotMatch(header, /\bthese (two|three|four|five|six|seven|eight|nine|ten)\b/i);
});

test('every keyframe that animates more than opacity/transform is named in the Rules', () => {
  const blocks = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)];
  assert.ok(blocks.length >= 5, 'keyframes found');
  for (const [, name, body] of blocks) {
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).filter((p) => !['opacity', 'transform', 'visibility'].includes(p));
    if (props.length) assert.match(header, new RegExp(`\\b${name}\\b`), `${name} animates ${props.join(', ')} and is not named as an exception`);
  }
});
