const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../../public/lens.js'), 'utf8');

// Runs public/lens.js against a minimal fake DOM.
function load({ chromium = true, calm = false, nodes = [] } = {}) {
  const attributes = { 'data-family': 'glass' }, frames = [], observed = [], observers = [];
  let mutate, mediaChange;
  const media = { matches: calm, addEventListener: (_, f) => { mediaChange = f; } };
  const context = {
    navigator: { userAgentData: chromium ? { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] } : undefined },
    matchMedia: () => media,
    getComputedStyle: () => ({ borderTopLeftRadius: '12px' }),
    requestAnimationFrame: (f) => frames.push(f),
    ResizeObserver: class { observe(n) { observed.push(n); } disconnect() {} unobserve() {} },
    MutationObserver: class { constructor(f) { this.f = f; mutate = mutate || f; observers.push(f); } observe() {} },
    module: { exports: {} },
    document: {
      documentElement: { getAttribute: (k) => attributes[k] ?? null, setAttribute: (k, v) => { attributes[k] = v; }, removeAttribute: (k) => { delete attributes[k]; } },
      body: {},
      querySelectorAll: () => nodes,
    },
  };
  vm.runInNewContext(code, context);
  return { lensWhen: (m) => { attributes['data-family'] = m; observers.forEach((o) => o([])); return attributes['data-lens']; }, attributes, observed, media, exports: context.module.exports, change: () => mediaChange(), mutate: () => { observers.at(-1)(); frames.splice(0).forEach((f) => f()); } };
}
const control = (width = 120, height = 36) => {
  const props = {};
  return { isConnected: true, props, style: { setProperty: (k, v) => { props[k] = v; } }, getBoundingClientRect: () => ({ width, height }) };
};

test('Chromium gets a per-size refraction filter on each lens control', () => {
  const a = control(), b = control(200, 44);
  const f = load({ nodes: [a, b] });
  assert.equal(f.attributes['data-lens'], 'svg');
  assert.match(a.props['--lens'], /^url\("data:image\/svg\+xml;utf8,.*#lens"\)$/);
  assert.notEqual(a.props['--lens'], b.props['--lens'], 'filters are sized to their element');
  assert.equal(f.observed.length, 2);
  assert.match(decodeURIComponent(a.props['--lens']), /feDisplacementMap/);
});

test('other engines keep the CSS fallback and do nothing', () => {
  const a = control();
  const f = load({ chromium: false, nodes: [a] });
  assert.equal(f.attributes['data-lens'], undefined);
  assert.equal(a.props['--lens'], undefined);
});

test('reduced transparency or motion turns the lens off and back on', () => {
  const a = control();
  const f = load({ calm: true, nodes: [a] });
  assert.equal(f.attributes['data-lens'], undefined);
  f.media.matches = false; f.change();
  assert.equal(f.attributes['data-lens'], 'svg');
  assert.ok(a.props['--lens']);
});

test('lens is only active in the Glass family', () => {
  const a = control();
  const f = load({ nodes: [a] });
  assert.equal(f.attributes['data-lens'], 'svg');
  assert.equal(f.lensWhen('editorial'), undefined);
  assert.equal(f.lensWhen('contemporary'), undefined);
  assert.equal(f.lensWhen('glass'), 'svg');
});

test('filters are cached by size and radius, and zero-size nodes are skipped', () => {
  const f = load({ nodes: [] });
  assert.equal(f.exports.filter(100, 30, 12), f.exports.filter(100, 30, 12));
  const hidden = control(0, 0);
  f.exports.fit(hidden);
  assert.equal(hidden.props['--lens'], undefined);
});

test('the in-app reduced-motion preference disables refraction too', () => {
  const a = control();
  const f = load({ nodes: [a] });
  f.attributes['data-motion'] = 'reduced'; f.change();
  assert.equal(f.attributes['data-lens'], undefined);
  f.attributes['data-motion'] = 'system'; f.change();
  assert.equal(f.attributes['data-lens'], 'svg');
});
