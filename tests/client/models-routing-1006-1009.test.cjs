'use strict';
// #1006 #1007 #1008 #1009 (owner review, 2026-10-07), the pure halves:
//   #1008 every old Models & routing tab maps to a section of the four, and a saved old id lands there;
//   #1006 Tools Automatic / Manual is derived the same way the server selects toolboxes;
//   #1007 the chat picker and Settings use one routing-mode component;
//   #1009 the cloud model fields are the searchable picker, fed from the server-side provider list.
// The browser proof is qa/models-routing-1006-1009.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const src = (name) => path.join(__dirname, '../../src', name);
const read = (name) => fs.readFileSync(src(name), 'utf8');
function load(name, requireMap = {}) {
  const exports_ = {};
  const code = ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, require: (id) => { if (!(id in requireMap)) throw Error(`unexpected require ${id}`); return requireMap[id]; }, Object });
  return exports_;
}

test('#1008: four sections, and every one of the eight old tabs maps into one of them', () => {
  const m = load('components/models/sections.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(m.MODEL_SECTIONS.map(([id]) => id))), ['models', 'routing', 'performance', 'advanced']);
  const old = ['overview', 'yours', 'discover', 'routing', 'projects', 'hardware', 'benchmarks', 'prompts'];
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(m.LEGACY_TABS).sort())), [...old].sort());
  for (const id of old) assert.ok(m.MODEL_SECTIONS.some(([s]) => s === m.LEGACY_TABS[id].tab), `${id} has a home`);
  assert.deepEqual(JSON.parse(JSON.stringify(m.savedSection('benchmarks'))), { tab: 'performance', panel: 'benchmarks' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.savedSection('discover'))), { tab: 'models', list: 'discover' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.savedSection('advanced'))), { tab: 'advanced' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.savedSection('__proto__'))), { tab: 'models' });
  assert.deepEqual(JSON.parse(JSON.stringify(m.savedSection(null))), { tab: 'models' });
});

test('#1008: the settings that lived on the old tabs are all still rendered by the sections', () => {
  const s = read('components/models/ModelsSettings.tsx');
  for (const piece of ['<LibraryTab', '<DownloadTab', '<RoutingSection', '<OverviewTab', '<InferenceBudgetSection />', '<BenchmarksTab />', '<HardwareTab />', '<PromptsTab />', '<ProjectRoutingSection', '<SamplingPresetsControl />', '<ChatGptConnect', '<DefaultModeSection />', '<RoutingModeSection', '<ReasoningControl global />']) {
    assert.ok(s.includes(piece), `${piece} is still reachable`);
  }
  assert.ok(!read('components/SettingsView.tsx').includes('<ChatGptConnect'), 'the ChatGPT connection moved out of AI providers');
});

test('#1006: Tools Automatic / Manual follows the server rule', () => {
  const { toolsModeOf } = load('tools-mode.ts');
  assert.equal(toolsModeOf({ toolsMode: 'auto', toolboxes: ['core', 'web'] }), 'auto');
  assert.equal(toolsModeOf({ toolsMode: 'manual' }), 'manual');
  assert.equal(toolsModeOf({ toolboxes: [] }), 'manual', 'a hand-picked (even empty) list is Manual');
  assert.equal(toolsModeOf({}), 'auto');
  assert.equal(toolsModeOf(null), 'auto');
});

test('#1006: the model picker no longer lists tools; the composer shows tool checkboxes only in Manual', () => {
  const popup = read('components/ModelPopup.tsx');
  assert.ok(!/mp-col-tools|mp-tool-list|fetchToolboxes/.test(popup), 'no tool list in the model dialog');
  const actions = read('components/ComposerActions.tsx');
  assert.match(actions, /\{mode === 'manual' && \(loading \?/);
  assert.match(actions, /tools\.mode\.auto/);
});

test('#1007: the chat picker and Settings render the same RoutingModeChoice', () => {
  assert.match(read('components/ProjectRoutingMode.tsx'), /<RoutingModeChoice /);
  assert.match(read('components/models/RoutingModeSection.tsx'), /<RoutingModeChoice /);
  assert.match(read('components/ModelPopup.tsx'), /<ProjectRoutingMode /);
  assert.ok(!/type="radio" name="routing-mode"/.test(read('components/models/RoutingModeSection.tsx')), 'no second copy of the radios');
});

test('#1009: the cloud model fields are the searchable picker fed by the server-side list', () => {
  const section = read('components/models/RoutingModeSection.tsx');
  assert.match(section, /<ModelCombobox /);
  assert.match(section, /fetchProviderModels\(providerId, refresh\)/);
  assert.ok(!/<input type="text" value=\{cloud\[role\]\}/.test(section), 'no free-text-only fields');
  const api = read('api.ts');
  assert.match(api, /\/api\/providers\/\$\{encodeURIComponent\(providerId\)\}\/models\$\{refresh \? '\?refresh=1' : ''\}/);
});
