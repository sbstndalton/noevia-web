// #1575: "Thought for 3s" on a one-minute turn. The reply's thinking was measured from its first thought to the
// first tool call only, so a later stretch of thinking was lost. The figure is now the sum of every stretch. Also:
// a tool result whose index was never announced joined as a new chip, so the count rose after the answer.
// Loads the pure modules from source (no browser).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Math, Object, Array, console,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const { createThinkingClock } = load('thinking-time');
const { resultSlot } = load('tool-call-state');

function fakeClock() {
  let t = 0;
  return { now: () => t, at: (ms) => { t = ms; } };
}

test('#1575 the thinking time is the sum of every stretch, not only the first', () => {
  const clock = fakeClock();
  const thinking = createThinkingClock(clock.now);
  clock.at(0); thinking.start();
  clock.at(3000); assert.equal(thinking.stop(), 3000, 'first stretch, before a tool call');
  clock.at(10_000); thinking.start();              // more thinking after the tool result
  clock.at(70_000); assert.equal(thinking.stop(), 63_000, 'total so far: 3 s + 60 s');
});

test('#1575 many tokens of an open stretch cost nothing: stop() only reports a closed stretch', () => {
  const clock = fakeClock();
  const thinking = createThinkingClock(clock.now);
  assert.equal(thinking.stop(), undefined, 'nothing was thought');
  clock.at(5); thinking.start(); clock.at(9); thinking.start();   // a second thought does not restart the stretch
  clock.at(20); assert.equal(thinking.stop(), 15, 'counted from the first thought');
  assert.equal(thinking.stop(), undefined, 'no open stretch, so nothing to write');
});

test('#1575 a result for a call announced by index joins that call', () => {
  const calls = [{ name: 'search', args: '', status: 'running' }, { name: 'fetch', args: '', status: 'running' }];
  assert.equal(resultSlot(calls, 1, 'fetch'), 1);
});

test('#1575 a result whose index was never announced joins the open call of that name, not a new chip', () => {
  const calls = [{ name: 'search', args: '', status: 'done' }, { name: 'search', args: '', status: 'running' }];
  assert.equal(resultSlot(calls, 5, 'search'), 1, 'the running search, not a third chip');
  assert.equal(resultSlot(calls, 5, 'write_file'), -1, 'no open call of that name: a call of its own');
});

test('#1575 without an index the first call of that name is used, as before', () => {
  const calls = [{ name: 'search', args: '', status: 'done' }, { name: 'search', args: '', status: 'running' }];
  assert.equal(resultSlot(calls, undefined, 'search'), 0);
  assert.equal(resultSlot([], undefined, 'search'), -1);
});
