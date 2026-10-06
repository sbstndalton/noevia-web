'use strict';
// #435 follow-up: programmatically focusing the composer textarea on a touch device pops the
// on-screen keyboard over whatever the person is reading — a worse outcome than leaving focus on
// <body> after a completed Send or a Stop. `isCoarsePointerDevice` is the pure signal that guards
// both of ChatView's focus-recovery paths (see the comment above `wasStreamingRef` there); it
// takes no ref and no DOM beyond `window.matchMedia`, so — like edit-focus.ts — it gets a real
// behavioural test here (transpiled and run in a fresh vm context) rather than only a source pin.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/composer-focus.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const exports_ = {};
vm.runInNewContext(code, { exports: exports_, window: undefined });
const { isCoarsePointerDevice } = exports_;

function fakeWindow(matches) {
  return { matchMedia: (query) => ({ matches: !!matches[query] }) };
}

test('a fine-pointer, hover-capable device (an ordinary desktop) is not coarse', () => {
  assert.equal(isCoarsePointerDevice(fakeWindow({ '(pointer: coarse)': false, '(hover: none)': false })), false);
});

test('a touch device reporting a coarse pointer is coarse', () => {
  assert.equal(isCoarsePointerDevice(fakeWindow({ '(pointer: coarse)': true, '(hover: none)': false })), true);
});

test('a device with no hover capability at all is treated as coarse too, even if pointer somehow reports fine', () => {
  assert.equal(isCoarsePointerDevice(fakeWindow({ '(pointer: coarse)': false, '(hover: none)': true })), true);
});

test('no window (SSR) or no matchMedia is never mistaken for a coarse pointer', () => {
  assert.equal(isCoarsePointerDevice(undefined), false);
  assert.equal(isCoarsePointerDevice({}), false);
});
