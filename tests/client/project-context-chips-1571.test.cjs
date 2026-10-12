// #1571: the project's context chips (Instructions, Memory, Sources) read as ghosts: the motion layer
// faded them in with a spring, and the measured opacity stayed partial or at 0. They are standing state, so
// the motion layer does not animate them. Source contract: the chip selector the motion layer enters, and
// the chips' own markup, which must stay fully opaque in CSS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MOTION = fs.readFileSync(path.join(ROOT, 'src/motion/index.ts'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'src/styles/app.css'), 'utf8');

test('#1571 the motion layer does not enter the project context chips', () => {
  const chips = /const CHIPS = '([^']*)'/.exec(MOTION);
  assert.ok(chips, 'CHIPS selector exists');
  assert.doesNotMatch(chips[1], /composer-context-chips/);
  // The chips that really arrive later still animate.
  assert.match(chips[1], /\.reply-source-chip/);
  assert.match(chips[1], /\.frame-chips > \*/);
});

test('#1571 nothing in the chip styles sets a partial opacity or a motion start state', () => {
  const rules = [...CSS.matchAll(/([^{}]*composer-context-chips[^{}]*)\{([^}]*)\}/g)];
  for (const [, selector, body] of rules) {
    assert.doesNotMatch(body, /opacity/, `${selector.trim()} has no opacity`);
  }
});
