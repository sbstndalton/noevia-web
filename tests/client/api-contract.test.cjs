const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../../src/api-contract.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
vm.runInNewContext(code, { exports: exported, AbortController, setTimeout, clearTimeout });
const { checkApiCompatibility, hasApiMajorMismatch, hasApiMajorMismatchHeader } = exported;

const response = (header, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Headers(header === null ? {} : { 'X-Noevia-API': header }),
});

test('v1 and legacy readiness are compatible; explicit different major blocks startup', async () => {
  for (const [header, expected] of [['1', 'compatible'], [null, 'compatible'], ['2', 'mismatch']]) {
    let path, init;
    const result = await checkApiCompatibility(async (p, i) => { path = p; init = i; return response(header); });
    assert.equal(result, expected);
    assert.equal(path, '/api/ready');
    assert.equal(init.cache, 'no-store');
  }
});

test('network and gateway failure leave existing connection handling in charge', async () => {
  assert.equal(await checkApiCompatibility(async () => { throw Error('offline'); }), 'unavailable');
  assert.equal(await checkApiCompatibility(async () => response(null, 503)), 'unavailable');
  assert.equal(hasApiMajorMismatch(response(null, 502)), false);
  const hung = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted'))));
  assert.equal(await checkApiCompatibility(hung, 5), 'unavailable');
});

test('normal API responses trigger a mismatch only for an explicit different major', () => {
  assert.equal(hasApiMajorMismatch(response('1', 401)), false);
  assert.equal(hasApiMajorMismatch(response(null, 401)), false);
  assert.equal(hasApiMajorMismatch(response('2', 200)), true);
  assert.equal(hasApiMajorMismatchHeader('2', 200), true, 'XHR upload path uses the same major rule');
  assert.equal(hasApiMajorMismatchHeader(null, 200), false);
});
