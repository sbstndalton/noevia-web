'use strict';
// Motion contract (#247, retuned in #951 to the Claude/ChatGPT reference): the reference
// durations and curves as tokens, the four-purpose contract mapped onto them, overshoot only on
// small physical controls, reduced motion honoured everywhere, keyframes only in motion.css.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = path.join(__dirname, '../../src/styles');
const read = (f) => fs.readFileSync(path.join(styles, f), 'utf8');
const tokens = read('system/tokens.css'), motion = read('system/motion.css'), components = read('system/components.css');
const sheets = [...fs.readdirSync(styles, { recursive: true }).filter((f) => f.endsWith('.css')).map((f) => [path.basename(f), read(f)]),
  ...fs.readdirSync(path.join(__dirname, '../../src/components'), { recursive: true }).filter((f) => f.endsWith('.css')).map((f) => [path.basename(f), fs.readFileSync(path.join(__dirname, '../../src/components', f), 'utf8')])];
const root = tokens.slice(tokens.indexOf(':root, .theme-scope {'));
const value = (css, name) => (css.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1]?.trim();
const PURPOSES = ['immediate', 'quick', 'considered', 'async'];

test('the reference timings are tokens with their captured values', () => {
  const expected = {
    '--dur-instant': '60ms', '--dur-snap': '120ms', '--dur-basic': '150ms', '--dur-base': '200ms', '--dur-panel': '240ms',
    '--dur-spring': '450ms', '--dur-pulse': '2s', '--delay-skeleton': '500ms', '--stagger-base': '50ms', '--stagger-step': '30ms',
    '--ease-out-quart': 'cubic-bezier(.165, .84, .44, 1)', '--ease-out-expo': 'cubic-bezier(.19, 1, .22, 1)',
    '--ease-overshoot': 'cubic-bezier(.34, 1.3, .64, 1)', '--ease-in-out': 'cubic-bezier(.4, 0, .2, 1)',
  };
  for (const [name, v] of Object.entries(expected)) assert.equal(value(root, name), v, name);
  assert.match(value(root, '--spring-press'), /^linear\(0, \.2459, \.6526/);
});

test('the four-purpose contract reads the reference tokens', () => {
  for (const p of PURPOSES) { assert.ok(value(root, `--motion-${p}`), `--motion-${p}`); assert.ok(value(root, `--ease-${p}`), `--ease-${p}`); }
  assert.equal(value(root, '--motion-immediate'), 'var(--dur-instant)');
  assert.equal(value(root, '--motion-considered'), 'var(--dur-base)');
  assert.equal(value(root, '--ease-considered'), 'var(--ease-out-quart)');
});

test('CSS overshoot only on small physical controls: switch knob, sent message', () => {
  for (const [file, css] of sheets) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of body.matchAll(/([^{}]+)\{[^}]*var\(--ease-overshoot\)[^}]*\}/g)) {
      assert.match(m[1], /knob|switch|::after|\.msg\[data-role='user'\]/, `${file}: ${m[1].trim()}`);
    }
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

test('every keyframe lives in motion.css with a justification, and every animation names one', () => {
  const names = [...motion.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  for (const [file, css] of sheets) if (file !== 'motion.css') assert.doesNotMatch(css, /@keyframes/, file);
  for (const name of names) {
    const before = motion.slice(0, motion.indexOf(`@keyframes ${name}`)).trimEnd();
    assert.ok(before.endsWith('*/'), `${name} has a justification comment directly above it`);
  }
  for (const [file, css] of sheets) for (const [, name] of css.matchAll(/(?<![-\w])animation\s*:\s*([\w-]+)/g)) {
    if (name !== 'none') assert.ok(names.includes(name), `${file}: ${name}`);
  }
});

test('reduced motion — OS or app setting — reaches every element, loops included', () => {
  const rule = /\*, \*::before, \*::after \{[^}]*animation-duration: 1ms !important;[^}]*animation-iteration-count: 1 !important;[^}]*transition: none !important;/;
  assert.match(motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)')), rule);
  assert.match(motion, /:root\[data-motion='reduced'\] \*, :root\[data-motion='reduced'\] \*::before, :root\[data-motion='reduced'\] \*::after \{[^}]*animation-iteration-count: 1 !important;[^}]*transition: none !important;/);
  assert.doesNotMatch(motion.replace(/\/\*[\s\S]*?\*\//g, ''), /transition-duration/);
  assert.match(tokens, /html:root\[data-motion='reduced'\] \{ --motion-quick: 1ms; --motion-considered: 1ms;/);
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\) \{\s*html:root \{ --motion-quick: 1ms;/);
});

test('Settings springs in and out through the motion layer, on a 50% scrim', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsShell.tsx'), 'utf8');
  assert.match(shell, /enterMotion\(node, 'dialog'\)/);
  // The exit resolves before Settings unmounts.
  assert.match(shell, /const exited = Promise\.all\(\[exitMotion\(node, 'dialog'\), exitMotion\(scrim, 'fade'\)\]\);/);
  // Raced against a timeout (a background tab runs no frames) and ignored once unmounted, so a
  // Settings reopened mid-exit is never closed by its predecessor; a second close is a no-op.
  assert.match(shell, /Promise\.race\(\[exited, timeout\]\)\.then\(\(\) => \{ if \(live\.current\) onClose\.current\(\); \}\)/);
  assert.match(shell, /if \(closingRef\.current\) return;/);
  assert.match(shell, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
  assert.doesNotMatch(components, /@starting-style \{ \.settings-stage/, 'no competing CSS entrance');
  assert.match(tokens, /--scrim: rgba\(0, 0, 0, \.5\);/);
});

test('the motion layer uses Motion\'s vanilla API, critically damped by default', () => {
  const layer = fs.readFileSync(path.join(__dirname, '../../src/motion/index.ts'), 'utf8');
  assert.match(layer, /import \{ animate \} from 'motion';/);
  assert.doesNotMatch(layer, /motion\/react|framer-motion/, 'no React-only API');
  assert.match(layer, /dialog: \{ type: 'spring', bounce: 0, visualDuration: 0\.22 \}/);
  assert.match(layer, /menu: \{ type: 'spring', bounce: 0, visualDuration: 0\.14 \}/);
  // Exits name targets only, so they continue from the current value.
  assert.match(layer, /dialog: \{ opacity: 0, scale: 0\.98 \},/);
  assert.match(layer, /if \(reducedMotion\(\)\)/);
});

test('the Chat/Cowork toggle moves a thumb on the considered token and the mode is on the element', () => {
  assert.match(components, /\.composer-mode-toggle::before \{[^}]*transition: transform var\(--motion-considered\) var\(--ease-considered\);/);
  assert.match(components, /\.composer-mode-toggle\[data-mode='cowork'\]::before \{ transform: translateX/);
  const bar = fs.readFileSync(path.join(__dirname, '../../src/components/ComposerModeBar.tsx'), 'utf8');
  assert.match(bar, /className=\{`composer-mode-toggle\$\{compact \? ' is-compact' : ''\}`\} data-mode=\{mode\} role="radiogroup"/);
});

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
