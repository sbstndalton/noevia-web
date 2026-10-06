'use strict';
// #387: auto-scroll must follow the stream only while the reader is at the bottom, and a
// scroll-up must stick until they return or send a new message — not get overridden by the
// pin-to-bottom effect's own write on the very next streamed token. `isAtBottom`/`nextFollowState`
// are the pure decision the hook is built from (see useChatScroll.ts for how `causedByUser` is
// derived from the hook's own programmatic-scroll guard, which is the actual race fix — a
// pure-function test cannot exercise a DOM `scroll` event, so that half is covered by reading the
// hook's source below).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/useChatScroll.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.None } },
).outputText;
// useChatScroll.ts imports from 'react'; stub just enough of it for the pure functions (which
// never touch React) to load without pulling in the real package.
const exports_ = {};
vm.runInNewContext(code, {
  exports: exports_,
  require: (id) => (id === 'react' ? { useLayoutEffect() {}, useRef() {}, useState: (v) => [v, () => {}] } : require(id)),
});
const { FOLLOW_THRESHOLD_PX, isAtBottom, nextFollowState } = exports_;

test('the threshold: within it counts as at the bottom, right at or past it does not', () => {
  assert.equal(isAtBottom(1000, 500, 500 - FOLLOW_THRESHOLD_PX + 1), true, 'just inside the threshold');
  assert.equal(isAtBottom(1000, 500, 500 - FOLLOW_THRESHOLD_PX), false, 'exactly at the threshold is not "close enough"');
  assert.equal(isAtBottom(1000, 500, 0), false, 'scrolled all the way to the top');
  assert.equal(isAtBottom(1000, 500, 500), true, 'scrolled exactly to the bottom');
});

test('a reader-caused scroll away from the bottom turns follow off, no matter what it was before', () => {
  assert.equal(nextFollowState(true, false, true), false);
  assert.equal(nextFollowState(false, false, true), false);
});

test('a reader-caused scroll back to the bottom turns follow on', () => {
  assert.equal(nextFollowState(false, true, true), true);
  assert.equal(nextFollowState(true, true, true), true);
});

test("the app's own scroll-to-bottom write never changes the follow state either way — this is the actual fix for #387's feedback loop", () => {
  // Before the fix, the effect's own `el.scrollTop = el.scrollHeight` fired a native `scroll`
  // event that fed back into the same "am I at the bottom" check and forced following back to
  // true, so a genuine scroll-up could never stick against a fast enough stream. A programmatic
  // write must be a no-op for the decision regardless of where it lands.
  assert.equal(nextFollowState(false, true, false), false, 'still not following, even though the write landed at the bottom');
  assert.equal(nextFollowState(true, false, false), true, 'still following, even if a programmatic write briefly reports "not at bottom" mid-scroll');
});

test('a fresh chat (scope change) is not exercised by these pure functions, but the hook resets following=true (and its own scrollTop memory) on scope change — asserted at the source level', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/useChatScroll.ts'), 'utf8');
  assert.match(src, /useLayoutEffect\(\(\) => \{ following\.current = true; setAtBottom\(true\); lastWrittenScrollTop\.current = null; \}, \[scope\]\)/);
});

test('#387 (reopened): the auto-scroll effect compares the live scrollTop against its own last write, synchronously, before deciding whether to pin again — not just the async `scroll` event, which a fast enough stream can outrace', () => {
  // A real wheel/touch/keyboard/scrollbar-drag scroll changes `el.scrollTop` immediately, as part of
  // the browser's own synchronous handling of that input, well before the (coalesced, can lag a fast
  // stream) native `scroll` event `onScroll` reads ever fires. Comparing the live value directly, right
  // here, closes that race for every input method — including a scrollbar drag, which has no dedicated
  // JS event of its own to listen for.
  const src = fs.readFileSync(path.join(__dirname, '../../src/useChatScroll.ts'), 'utf8');
  assert.match(src, /lastWrittenScrollTop\.current !== null && el\.scrollTop !== lastWrittenScrollTop\.current/);
  assert.match(src, /following\.current = nextFollowState\(following\.current, atBottomNow, true\);/);
});

test('#387 (reopened): onScroll also records the position it just reconciled, so the synchronous compare above does not re-litigate a scroll the async handler already accounted for against a since-grown scrollHeight (this was a regression caught by qa/diary-reading.cjs — a scripted return-to-bottom scroll event got immediately re-disengaged by the next streamed chunk)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/useChatScroll.ts'), 'utf8');
  assert.match(src, /if \(causedByUser\) \{[\s\S]*?lastWrittenScrollTop\.current = el\.scrollTop;[\s\S]*?\}/);
});

test('the hook exposes atBottom so a caller can render a "jump to latest" control, and follow() jumps back down', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/useChatScroll.ts'), 'utf8');
  assert.match(src, /return \{ scrollRef, onScroll, follow, atBottom \};/);
  assert.match(src, /const follow = \(\) => \{/);
});
