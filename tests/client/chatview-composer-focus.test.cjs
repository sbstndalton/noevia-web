'use strict';
// #435: after Stop or a completed Send, focus was dropping to <body> because the composer
// textarea is `disabled` for the duration (most browsers blur a focused control the instant it is
// disabled) and nothing ever restored it. Stop and a completed Send needed two different rules —
// see the comment above `wasStreamingRef` in ChatView.tsx for why a mouse click on Stop does not,
// on its own, leave focus on <body> (the Stop/Send button is the same DOM node across the
// transition, so React keeps focus sitting on it rather than dropping it — this was caught by
// actually running qa/composer-434.cjs in a browser, not by source inspection). There is no jsdom
// in this repo (see tests/client/chatview-draft-persistence.test.cjs's note on that), so the real
// behaviour is proven in a real browser by apps/web/qa/composer-434.cjs; this pins the
// source-level contract the same way tests/client/chatview-edit-actions.test.cjs pins #355.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');
const region = src.slice(src.indexOf('const { scrollRef, onScroll, follow, atBottom }'), src.indexOf("// When the current stream began"));

test('the composer keeps a ref to the textarea it can move focus back into', () => {
  assert.match(region, /const composerRef = useRef<HTMLTextAreaElement \| null>\(null\);/);
  assert.match(src, /<ComposerTextarea\s*\n\s*ref=\{composerRef\}/);
});

test('focus restoration is keyed on the falling edge of `streaming` (it just ended)', () => {
  assert.match(region, /const wasStreamingRef = useRef\(streaming\);/);
  assert.match(region, /useEffect\(\(\) => \{\s*const wasStreaming = wasStreamingRef\.current;\s*wasStreamingRef\.current = streaming;/);
  assert.match(region, /\}, \[streaming\]\);/);
});

test('Stop always reclaims focus — a stopRequestedRef set by the Stop button itself, not just an activeElement check, since the Stop/Send button is the same DOM node across the transition and a click leaves focus sitting on it, not on <body>', () => {
  assert.match(region, /const stopRequestedRef = useRef\(false\);/);
  assert.match(region, /const stopped = stopRequestedRef\.current;/);
  assert.match(region, /if \(stopped \|\| document\.activeElement === document\.body\) composerRef\.current\?\.focus\(\);/);
  assert.match(src, /onClick=\{\(\) => \{ stopRequestedRef\.current = true; onStop\(\); \}\}/);
});

test('a completed Send only reclaims focus if it is still sitting on <body> — a user who has since clicked elsewhere keeps their own focus', () => {
  assert.match(region, /if \(!wasStreaming \|\| streaming \|\| typeof document === 'undefined' \|\| isCoarsePointerDevice\(\)\) return;/);
});

test('neither focus-recovery path runs on a coarse pointer (touch) device — programmatically focusing there would pop the on-screen keyboard', () => {
  assert.match(src, /import \{ isCoarsePointerDevice \} from '\.\.\/composer-focus';/);
  assert.match(region, /isCoarsePointerDevice\(\)\) return;/);
});
