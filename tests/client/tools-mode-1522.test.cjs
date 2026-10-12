'use strict';
// #1522 (web side): a new project or chat reads as Automatic, and the Manual fallback is only for
// projects that predate toolsMode. Pure: tools-mode.ts is loaded and run in a sandbox, no DOM.
// The server half (create writes toolsMode: 'auto') is the noevia-core draft, not this repo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8');
function load(name) {
  const exports_ = {};
  const code = ts.transpileModule(read(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, require: (id) => { throw Error(`unexpected require ${id}`); }, Object });
  return exports_;
}
const { toolsModeOf, NEW_PROJECT_TOOLS_MODE } = load('tools-mode.ts');

test('#1522: a project created by the server with a toolboxes array and toolsMode auto is Automatic', () => {
  // The shape a new project takes once the server writes toolsMode on create (default set + the mode).
  assert.equal(toolsModeOf({ toolsMode: 'auto', toolboxes: ['core'] }), 'auto');
  assert.equal(toolsModeOf({ toolsMode: 'auto', toolboxes: ['core', 'web'] }), 'auto', 'an explicit mode beats the list');
});

test('#1522: the new-project mode the web sends is Automatic and reads back as Automatic', () => {
  assert.equal(NEW_PROJECT_TOOLS_MODE, 'auto');
  assert.equal(toolsModeOf({ toolsMode: NEW_PROJECT_TOOLS_MODE, toolboxes: ['core'] }), 'auto');
});

test('#1522: an explicit manual is Manual even with no list, and the list is not needed to say so', () => {
  assert.equal(toolsModeOf({ toolsMode: 'manual', toolboxes: ['core'] }), 'manual');
  assert.equal(toolsModeOf({ toolsMode: 'manual' }), 'manual');
});

test('#1522: without toolsMode, a hand-picked list is still Manual, as core reads it (projectToolboxIds)', () => {
  // Legacy projects were saved with a list and no toolsMode; core runs them on that list, so the menu says Manual.
  assert.equal(toolsModeOf({ toolboxes: ['core'] }), 'manual');
  assert.equal(toolsModeOf({ toolboxes: [] }), 'manual');
});

test('#1522: without toolsMode or a list, a project is Automatic (the default set)', () => {
  assert.equal(toolsModeOf({}), 'auto');
  assert.equal(toolsModeOf(null), 'auto');
  assert.equal(toolsModeOf(undefined), 'auto');
});

test('#1522: a malformed toolsMode is ignored, so the array-presence rule decides, as on the server', () => {
  assert.equal(toolsModeOf({ toolsMode: 'AUTO', toolboxes: ['core'] }), 'manual');
  assert.equal(toolsModeOf({ toolsMode: 'sometimes' }), 'auto');
  assert.equal(toolsModeOf({ toolsMode: null, toolboxes: ['core'] }), 'manual');
});

test('#1522: the create call in App sends the new-project mode, and the API type accepts it', () => {
  const app = read('App.tsx');
  assert.match(app, /createProject\(\{ \.\.\.body, toolsMode: NEW_PROJECT_TOOLS_MODE \}\)/);
  assert.match(app, /import \{ NEW_PROJECT_TOOLS_MODE \} from '\.\/tools-mode';/);
  assert.match(read('api.ts'), /toolsMode\?: 'auto' \| 'manual';\n\}\): Promise<Project> \{\n  return postJson\('\/api\/projects'/);
});
