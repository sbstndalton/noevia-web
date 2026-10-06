'use strict';
// Hover pull (#313): caps, direction, the 10 Hz refresh limit (no clinging), the return, and
// the off switches (touch, coarse pointers, reduced motion, text entry). Synthetic DOM only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObj = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/hover-pull.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObj, Math, Number });
const pull = exportsObj;
const box = { left: 100, top: 100, width: 200, height: 40 };

test('pull points toward the pointer, translate only, never more than 3px per axis', () => {
  const right = pull.pullFor(box, 300, 120);
  assert.deepEqual({ ...right }, { x: 3, y: 0 });
  assert.deepEqual({ ...pull.pullFor(box, 100, 100) }, { x: -3, y: -3 });
  for (const [x, y] of [[-5000, -5000], [5000, 5000], [200, 120], [150, 90], [301, 141]]) {
    const p = pull.pullFor(box, x, y);
    assert.ok(Math.abs(p.x) <= pull.PULL_MAX_SHIFT && Math.abs(p.y) <= pull.PULL_MAX_SHIFT, JSON.stringify(p));
    const frame = pull.pullKeyframe(p);
    assert.deepEqual(Object.keys(frame), ['translate'], 'no rotate, no transform: composes with component transforms');
  }
  assert.equal(pull.PULL_MAX_TILT, undefined, 'tilt was dropped (invisible without perspective)');
  assert.deepEqual({ ...pull.pullFor(box, 200, 120) }, { x: 0, y: 0 });
  assert.deepEqual({ ...pull.pullFor({ left: 0, top: 0, width: 0, height: 0 }, 5, 5) }, { x: 0, y: 0 });
});

test('the target list covers cards, buttons, sidebar rows and chips, never text entry', () => {
  for (const s of ['.project-card', '.btn', '.new-chat-btn', '.chat-row', '.chip']) assert.ok(pull.PULL_TARGETS.includes(s), s);
  assert.doesNotMatch(pull.PULL_TARGETS, /\b(input|textarea|select)\b/);
});

// A tiny DOM: a pullable button (with a span) inside a wrapper, and an input; records animations.
function harness({ fine = true, reduced = false, motion = null } = {}) {
  const listeners = {}, animations = [], mediaListeners = [];
  const state = { reduced };
  const media = (q) => ({ get matches() { return q.includes('reduced-motion') ? state.reduced : fine; }, addEventListener: (t, f) => mediaListeners.push(f), removeEventListener() {} });
  const attrs = { 'data-motion': motion };
  const root = { getAttribute: (k) => attrs[k] ?? null };
  const el = (name, matches, parent = null) => {
    const node = {
      name, parent, disabled: false, connected: true, attributes: {}, inline: {},
      get isConnected() { for (let n = this; n; n = n.parent) if (!n.connected) return false; return true; },
      style: { removeProperty(k) { delete node.inline[k]; }, getPropertyValue: (k) => node.inline[k] || '' },
      setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; }, getAttribute(k) { return this.attributes[k] ?? null; },
      getBoundingClientRect: () => box,
      contains(other) { for (let n = other; n; n = n.parent) if (n === this) return true; return false; },
      closest(sel) { for (let n = this; n; n = n.parent) if (n.matches(sel)) return n; return null; },
      matches(sel) { return matches.call(node, sel); },
      animate(frames, opts) { const a = { el: node, frames, opts, cancelled: false, cancel() { this.cancelled = true; }, commitStyles() {}, addEventListener() {} }; animations.push(a); return a; },
    };
    return node;
  };
  const wrap = el('fieldset', function (sel) {
    return (sel.includes('fieldset:disabled') && this.disabled) || (sel.includes('[aria-disabled="true"]') && this.attributes['aria-disabled'] === 'true');
  });
  const button = el('button', function (sel) { return sel === pull.PULL_TARGETS || (sel === ':disabled' && this.disabled); }, wrap);
  const label = el('span', () => false, button);
  const input = el('input', (sel) => /\binput\b/.test(sel) && sel !== pull.PULL_TARGETS);
  const doc = { documentElement: root, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {} };
  const win = { matchMedia: media, getComputedStyle: () => ({ getPropertyValue: (n) => (n === '--motion-quick' ? '180ms' : n === '--motion-considered' ? '300ms' : 'ease-out') }) };
  const stop = pull.startHoverPull(doc, win);
  const fire = (type, target, extra = {}) => listeners[type]({ target, clientX: 300, clientY: 120, pointerType: 'mouse', timeStamp: 0, relatedTarget: null, ...extra });
  const setReduced = (v) => { state.reduced = v; mediaListeners.forEach((f) => f()); };
  return { fire, wrap, button, label, input, animations, stop, setReduced };
}

test('enter pulls once; moves refresh at most every 100 ms; leave springs back', () => {
  const h = harness();
  h.fire('pointerover', h.label, { timeStamp: 1000 });
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].opts.duration, 180);
  assert.equal(h.animations[0].frames[0].translate, '3px 0px');
  for (let t = 1010; t < 1100; t += 10) h.fire('pointermove', h.label, { timeStamp: t });
  assert.equal(h.animations.length, 1, 'no refresh inside 100 ms');
  h.fire('pointermove', h.label, { timeStamp: 1100, clientX: 100 });
  assert.equal(h.animations.length, 2);
  assert.equal(h.animations[1].frames[0].translate, '-3px 0px', 'refresh keeps the same cap');
  // Moving onto the button's own child is not a leave.
  h.fire('pointerout', h.button, { relatedTarget: h.label });
  assert.equal(h.animations.length, 2);
  h.fire('pointerout', h.label, { relatedTarget: null });
  assert.equal(h.animations.length, 3);
  assert.equal(h.animations[2].opts.duration, 300);
  assert.equal(h.animations[2].frames[0].translate, '0px 0px');
  h.stop();
});

test('off for touch, coarse pointers, reduced motion (OS or Settings) and text inputs', () => {
  for (const opts of [{ fine: false }, { reduced: true }, { motion: 'reduced' }]) {
    const h = harness(opts);
    h.fire('pointerover', h.label, { timeStamp: 1000 });
    assert.equal(h.animations.length, 0, JSON.stringify(opts));
  }
  const h = harness();
  h.fire('pointerover', h.label, { pointerType: 'touch' });
  h.fire('pointerover', h.input);
  assert.equal(h.animations.length, 0);
  for (const disable of [
    () => { h.button.disabled = true; },
    () => { h.wrap.attributes['aria-disabled'] = 'true'; },
    () => { h.wrap.disabled = true; },
  ]) {
    h.button.disabled = false; h.wrap.disabled = false; delete h.wrap.attributes['aria-disabled'];
    disable();
    h.fire('pointerover', h.label);
    assert.equal(h.animations.length, 0, 'disabled buttons, aria-disabled ancestors and disabled fieldsets stay still');
    h.fire('pointerout', h.label);
  }
});

test('switching to reduced motion mid-hover stops at once, with no return animation', () => {
  const h = harness();
  h.fire('pointerover', h.label, { timeStamp: 1000 });
  assert.equal(h.animations.length, 1);
  h.setReduced(true);
  assert.equal(h.animations[0].cancelled, true, 'active pull cancelled');
  assert.equal(h.animations.length, 1, 'no spring back is played');
  assert.equal(h.button.getAttribute('data-pulling'), null);
});

test('a pulled node that leaves the document is dropped on the next event', () => {
  const h = harness();
  h.fire('pointerover', h.label, { timeStamp: 1000 });
  h.wrap.connected = false;
  h.fire('pointermove', h.label, { timeStamp: 1500 });
  assert.equal(h.animations.length, 1, 'no refresh, no return on a detached node');
  assert.equal(h.animations[0].cancelled, true);
  // A fresh target afterwards works normally.
  h.wrap.connected = true;
  h.fire('pointerover', h.label, { timeStamp: 2000 });
  assert.equal(h.animations.length, 2);
});
