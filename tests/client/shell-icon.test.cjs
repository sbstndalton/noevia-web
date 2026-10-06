'use strict';
// Icons come from one vendored Lucide subset: every ShellIcon name must resolve to a real icon, and the
// settings sections must not share a symbol.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: (m) => (m.includes('lucide') ? load('src/components/icons/lucide.ts') : m.startsWith('./icons/Icon') ? { Icon: () => null } : require(m)) }); return exports; };
test('every shell icon name resolves to a vendored Lucide icon', () => {
  const { LUCIDE } = load('src/components/icons/lucide.ts');
  const { SHELL_ICONS } = load('src/components/ShellIcon.tsx');
  for (const [name, lucide] of Object.entries(SHELL_ICONS)) assert.ok(LUCIDE[lucide], `${name} → ${lucide} is not vendored`);
  assert.equal(JSON.stringify(LUCIDE.x), JSON.stringify([['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]]), 'close is a symmetric ×');
});
test('settings sections use distinct symbols', () => {
  const { SHELL_ICONS } = load('src/components/ShellIcon.tsx');
  const sections = ['profile', 'security', 'appearance', 'capabilities', 'diary', 'providers', 'usage', 'planned', 'users', 'models', 'status', 'features', 'backups'];
  const symbols = sections.map((s) => SHELL_ICONS[s]);
  assert.equal(new Set(symbols).size, sections.length, symbols.join(', '));
});
test('the Lucide license travels with the vendored data', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../../src/components/icons/LICENSE-lucide.txt'), 'utf8'), /ISC License/);
});
