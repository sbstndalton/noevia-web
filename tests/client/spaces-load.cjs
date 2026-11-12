'use strict';
// Loads a src/*.ts module of the Spaces area for node:test (no bundler): transpiled to CommonJS and run in a vm.
// Relative imports resolve to the real sibling modules; anything in `stubs` replaces an import by name.
// Not a test file (no *.test.cjs suffix).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, stubs = {}) {
  const full = path.join(__dirname, '../../src', file);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports_ = {};
  const require_ = (name) => {
    if (name in stubs) return stubs[name];
    if (name.startsWith('./')) return load(name.slice(2) + '.ts', stubs);
    throw new Error(`unexpected import ${name}`);
  };
  vm.runInNewContext(code, { exports: exports_, require: require_, TextEncoder, URLSearchParams, URL, setTimeout, clearTimeout, AbortController, Promise, Error, JSON, Intl, Date, Array, Object }, { filename: full });
  return exports_;
}
module.exports = { load };
