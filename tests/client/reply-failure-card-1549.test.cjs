// #1549: the failure is an inline error card in the interface font with the danger colour and its own
// mark, not the reply body's monospace and not the accent green. Reads the stylesheet source directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

test('#1549 the failure card styles use the danger token and the interface font, never monospace', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/noevia.css'), 'utf8');
  const rule = /\.msg-failure \{([^}]*)\}/.exec(css);
  assert.ok(rule, '.msg-failure rule exists');
  // A full danger outline, not a one-sided stripe (the design lint rejects side-tab borders).
  assert.match(rule[1], /border:\s*1px solid var\(--danger\)/);
  assert.match(rule[1], /font-family:\s*var\(--font-ui\)/);
  assert.doesNotMatch(rule[1], /--font-mono|--accent/);
});
