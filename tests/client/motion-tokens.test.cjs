'use strict';
// Motion contract (#247): four purposes as tokens, curves without overshoot, durations inside
// the ranges the contract names, reduced motion honoured everywhere, few keyframes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = path.join(__dirname, '../../src/styles');
const read = (f) => fs.readFileSync(path.join(styles, f), 'utf8');
const tokens = read('tokens.css'), themes = read('themes.css'), motion = read('motion.css');
const sheets = [...fs.readdirSync(styles).filter((f) => f.endsWith('.css')).map((f) => [f, read(f)]),
  ...fs.readdirSync(path.join(__dirname, '../../src/components')).filter((f) => f.endsWith('.css')).map((f) => [f, fs.readFileSync(path.join(__dirname, '../../src/components', f), 'utf8')])];
const root = tokens.slice(tokens.indexOf(':root, .theme-scope {'));
const value = (css, name) => (css.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1]?.trim();
const ms = (v) => (v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000);
const PURPOSES = ['immediate', 'quick', 'considered', 'async'];

test('the contract is four purposes, each a duration and an easing', () => {
  const durations = [...root.matchAll(/--motion-([a-z]+):/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(durations)], PURPOSES);
  for (const p of PURPOSES) assert.ok(value(root, `--ease-${p}`), `--ease-${p}`);
});

test('durations sit in their purpose ranges in every family', () => {
  const ranges = { immediate: [80, 120], quick: [120, 200], considered: [200, 300], async: [800, 2000] };
  const blocks = [root, ...['editorial', 'contemporary', 'glass'].map((f) => themes.match(new RegExp(`\\[data-family='${f}'\\] \\{([^}]*)\\}`))[1])];
  for (const block of blocks) for (const p of PURPOSES) {
    const v = value(block, `--motion-${p}`);
    if (!v) continue;
    const [lo, hi] = ranges[p];
    assert.ok(ms(v) >= lo && ms(v) <= hi, `--motion-${p}: ${v} outside ${lo}–${hi}ms`);
  }
});

test('easings never overshoot and enter/move curves are not ease-in', () => {
  for (const p of PURPOSES) {
    const v = value(root, `--ease-${p}`);
    const bezier = v.match(/cubic-bezier\(([^)]+)\)/);
    if (bezier) {
      const [x1, y1, x2, y2] = bezier[1].split(',').map(Number);
      for (const n of [x1, y1, x2, y2]) assert.ok(n >= 0 && n <= 1, `${p}: ${v}`);
      assert.ok(y1 >= x1, `${p} starts fast (ease-out family), not ease-in: ${v}`);
    } else assert.match(v, /^(ease|linear)$/);
  }
});

test('earlier timing names are aliases of the contract, not timings of their own', () => {
  for (const name of ['--duration-instant', '--duration-fast', '--duration-base', '--duration-slow', '--duration-page', '--ease-standard', '--ease-out', '--ease-in', '--ease-spring']) {
    assert.match(value(root, name), /^var\(--(motion|ease)-(immediate|quick|considered|async)\)$/, name);
  }
});

test('no stylesheet uses transition: all or a literal duration outside the contract', () => {
  for (const [file, css] of sheets) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(body, /transition(-property)?\s*:\s*all\b/, file);
    if (file === 'tokens.css' || file === 'motion.css') continue;
    for (const [, decl] of body.matchAll(/(?<![-\w])((?:transition|animation)(?:-duration|-delay)?\s*:[^;}]*)/g)) {
      assert.doesNotMatch(decl.replace(/var\([^)]*\)/g, ''), /(?<![\w.-])\d*\.?\d+m?s\b/, `${file}: ${decl}`);
    }
  }
});

test('five keyframes in the whole app, all in motion.css, each explained', () => {
  const all = sheets.flatMap(([file, css]) => [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => `${file}:${m[1]}`));
  assert.deepEqual(all.sort(), ['motion.css:motion-enter', 'motion.css:motion-exit', 'motion.css:motion-pulse', 'motion.css:motion-spin', 'motion.css:sidebar-title-scroll']);
  for (const name of ['motion-enter', 'motion-exit', 'motion-pulse', 'motion-spin', 'sidebar-title-scroll']) {
    const before = motion.slice(0, motion.indexOf(`@keyframes ${name}`)).trimEnd();
    assert.ok(before.endsWith('*/'), `${name} has a justification comment directly above it`);
  }
  // Every animation used names one of them.
  for (const [file, css] of sheets) for (const [, name] of css.matchAll(/(?<![-\w])animation\s*:\s*([\w-]+)/g)) {
    if (name !== 'none') assert.match(name, /^(motion-(enter|exit|pulse|spin)|sidebar-title-scroll)$/, `${file}: ${name}`);
  }
});

test('reduced motion — OS or app setting — reaches every element, loops included', () => {
  const rule = /\*, \*::before, \*::after \{[^}]*animation-duration: 1ms !important;[^}]*animation-iteration-count: 1 !important;[^}]*transition: none !important;/;
  assert.match(motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)')), rule);
  assert.match(motion, /:root\[data-motion='reduced'\] \*, :root\[data-motion='reduced'\] \*::before, :root\[data-motion='reduced'\] \*::after \{[^}]*animation-iteration-count: 1 !important;[^}]*transition: none !important;/);
  // Never a bare global transition-duration: it would switch on `transition-property: all`.
  assert.doesNotMatch(motion.replace(/\/\*[\s\S]*?\*\//g, ''), /transition-duration/);
  // The token collapse outranks family blocks ([data-family] is 0,1,0; html:root[data-family] is 0,2,1).
  assert.match(tokens, /html:root\[data-motion='reduced'\]\[data-family\] \{ --motion-quick: 1ms; --motion-considered: 1ms;/);
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\) \{\s*html:root, html:root\[data-family\] \{ --motion-quick: 1ms;/);
});

test('the Chat/Cowork toggle moves a thumb on the considered token and the mode is on the element', () => {
  const system = read('system.css');
  assert.match(system, /\.composer-mode-toggle::before \{[^}]*transition: transform var\(--motion-considered\) var\(--ease-considered\);/);
  assert.match(system, /\.composer-mode-toggle\[data-mode='cowork'\]::before \{ transform: translateX/);
  const bar = fs.readFileSync(path.join(__dirname, '../../src/components/ComposerModeBar.tsx'), 'utf8');
  // #527: the phone composer's compact chip adds a class; the mode stays on the same element.
  assert.match(bar, /className=\{`composer-mode-toggle\$\{compact \? ' is-compact' : ''\}`\} data-mode=\{mode\} role="radiogroup"/);
});

// #529: the drawer and the phone sheet slide without fading (--enter-opacity: 1). As inherited
// custom properties that setting reached every menu and toast drawn inside them, which then
// entered with no visible motion. The travel parameters are registered as non-inherited.
test('entrance and exit travel belong to the animating element, not its descendants', () => {
  for (const name of ['--enter-from', '--enter-opacity', '--exit-to']) {
    assert.match(motion, new RegExp(`@property ${name} \\{[^}]*inherits: false;`), name);
  }
  assert.match(motion, /@property --enter-opacity \{[^}]*initial-value: 0;/);
});

test('a centred toast enters from its own centred position', () => {
  const overlays = read('overlays.css');
  const toast = overlays.match(/\n\.save-error \{([^}]*)\}/)[1];
  assert.match(toast, /transform: translateX\(-50%\)/);
  assert.match(toast, /--enter-from: translateX\(-50%\) /, 'the entrance frame keeps the centring translate');
});

test('the phone Chat/Cowork chip moves its highlight on the considered token (#527, #529)', () => {
  const tiers = read('space-tiers.css');
  const before = tiers.match(/\.composer-mode-toggle\.is-compact button::before \{([^}]*)\}/)[1];
  assert.match(before, /border-radius: var\(--radius-control\)/);
  assert.match(before, /transition: opacity var\(--motion-considered\) var\(--ease-considered\), transform var\(--motion-considered\) var\(--ease-considered\);/);
  assert.match(tiers, /\.composer-mode-toggle\.is-compact button\[aria-checked='true'\]::before \{ opacity: 1; transform: none; \}/);
});
