// #1472: a request that never reached the server showed "TypeError: Failed to fetch" in the footer and
// "Request failed - Failed to fetch" in the reply. The screen now gets a plain sentence; the raw exception
// goes to the console. Loads failure-copy.ts and the real English catalogue from source (no browser).
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
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, Error, TypeError, console, Promise, TextEncoder,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const { failureCopy, isNetworkFailure } = load('failure-copy');
const en = load('i18n/en-GB').EN_GB;
const say = (key) => en[key];

test('#1472 a dropped connection reads as a plain sentence, never the exception name', () => {
  for (const message of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
    const err = new TypeError(message);
    assert.equal(isNetworkFailure(err), true, message);
    const shown = failureCopy(err, say);
    assert.equal(shown, 'Cannot reach noevia. Check your connection and try again.');
    assert.doesNotMatch(shown, /TypeError|Failed to fetch/);
  }
});

test('#1472 other exceptions keep their own message, and an empty one gets a plain fallback', () => {
  assert.equal(isNetworkFailure(new TypeError("Cannot read properties of undefined")), false);
  assert.equal(failureCopy(new TypeError('Cannot read properties of undefined'), say), 'Cannot read properties of undefined');
  assert.equal(failureCopy(new Error('Could not refresh chat attachments'), say), 'Could not refresh chat attachments');
  assert.equal(failureCopy(new Error('   '), say), 'The reply could not be finished. Try again.');
  assert.equal(failureCopy('not an error', say), 'The reply could not be finished. Try again.');
});
