const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Runs public/glass-highlight.js against a minimal fake DOM.
function load({ reduced = false, coarse = false, family = 'glass', motion = 'system' } = {}) {
  const handlers = {};
  const frames = [];
  const el = (matches, position = 'static') => {
    const props = {}, attrs = {}, classes = new Set();
    const node = {
      isConnected: true, props, attrs, classes,
      style: { setProperty: (k, v) => { props[k] = v; } },
      classList: { add: (...c) => c.forEach((x) => classes.add(x)) },
      setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; },
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 40 }),
      closest: (sel) => (matches ? node : null), position,
    };
    return node;
  };
  const context = {
    matchMedia: (q) => ({ matches: q.includes('reduce') ? reduced : q.includes('coarse') ? coarse : false, addEventListener() {} }),
    MutationObserver: class { observe() {} },
    document: { documentElement: { getAttribute: k => k === 'data-family' ? family : motion }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    getComputedStyle: (node) => ({ position: node.position }),
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    Element: Object, module: { exports: {} },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/glass-highlight.js'), 'utf8'), context);
  const flush = () => { while (frames.length) frames.shift()(); };
  return { handlers, el, flush, exports: context.module.exports };
}

test('the glint follows the pointer inside a glass control and the opposite light mirrors it', () => {
  const { handlers, el, flush } = load();
  const button = el(true);
  handlers.pointermove({ target: button, clientX: 150, clientY: 60, pointerType: 'mouse' });
  flush();
  assert.equal(button.props['--glass-x'], '50px');
  assert.equal(button.props['--glass-y'], '10px');
  assert.equal(button.props['--glass-opposite-x'], '150px');
  assert.equal(button.props['--glass-opposite-y'], '30px');
  assert.ok(button.classes.has('glass-reactive'));
  assert.ok(button.classes.has('glass-positioned'), 'static elements get a positioning context for ::after');
  assert.equal(button.attrs['data-glass-active'], '');
});

test('leaving clears the active state; already-positioned elements keep their position', () => {
  const { handlers, el, flush } = load();
  const pill = el(true, 'absolute');
  handlers.pointermove({ target: pill, clientX: 120, clientY: 55, pointerType: 'mouse' });
  flush();
  assert.equal(pill.classes.has('glass-positioned'), false);
  handlers.pointerout({ target: pill, relatedTarget: null });
  assert.equal('data-glass-active' in pill.attrs, false);
});

test('touch, reduced motion and non-glass targets do nothing', () => {
  for (const options of [{ reduced: true }, { coarse: true }, { family: 'editorial' }, { family: 'contemporary' }, { motion: 'reduced' }]) {
    const { handlers, el, flush } = load(options);
    const button = el(true);
    handlers.pointermove({ target: button, clientX: 150, clientY: 60, pointerType: 'mouse' });
    flush();
    assert.deepEqual(button.props, {});
  }
  const { handlers, el, flush } = load();
  const text = el(false);
  handlers.pointermove({ target: text, clientX: 1, clientY: 1, pointerType: 'mouse' });
  handlers.pointermove({ target: el(true), clientX: 1, clientY: 1, pointerType: 'touch' });
  flush();
  assert.deepEqual(text.props, {});
});

test('leaving before the queued frame runs does not re-light the control', () => {
  const { handlers, el, flush } = load();
  const button = el(true);
  const outside = el(false);
  handlers.pointermove({ target: button, clientX: 150, clientY: 60, pointerType: 'mouse' });
  handlers.pointermove({ target: outside, clientX: 900, clientY: 900, pointerType: 'mouse' });
  flush();
  assert.equal('data-glass-active' in button.attrs, false);
});
