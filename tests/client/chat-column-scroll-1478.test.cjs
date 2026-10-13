// #1478: after a long or failed reply the chat column scrolled 377-405 px inside the overflow-hidden
// .app-main, pushing the header out of view and floating the composer mid-screen. A hidden container
// must not be a scroll container, and the composer's programmatic focus must not scroll anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/styles/noevia.css'), 'utf8');
const CHAT = fs.readFileSync(path.join(ROOT, 'src/components/ChatView.tsx'), 'utf8');

test('#1478 the app pane is clipped, not a scroll container (overflow: clip after the hidden fallback)', () => {
  const rule = /\.app-main \{([^}]*)\}/.exec(CSS);
  assert.ok(rule, '.app-main rule exists');
  const declarations = [...rule[1].matchAll(/overflow:\s*([a-z-]+)/g)].map((m) => m[1]);
  assert.deepEqual(declarations, ['hidden', 'clip'], 'hidden as the fallback, clip as the value supporting browsers use');
});

test('#1478 the composer is focused without scrolling the pane', () => {
  assert.doesNotMatch(CHAT, /composerRef\.current\?\.focus\(\)/, 'no bare focus() on the composer');
  assert.doesNotMatch(CHAT, /el\.focus\(\); el\.setSelectionRange/, 'no bare focus() before setSelectionRange');
  const preventing = CHAT.match(/focus\(\{ preventScroll: true \}\)/g) || [];
  assert.equal(preventing.length, 2, 'both composer focus calls pass preventScroll');
});
