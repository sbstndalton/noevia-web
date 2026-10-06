const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/stale-shell-guard.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

// Loads the module fresh into a small sandbox with __NOEVIA_BUILD__ and
// globals (fetch/location/sessionStorage) stubbed per test.
function load({ build = '0.2.0', fetchImpl, storage, replaced = [], href = 'https://noevia.example/settings', historyReplaced = [] } = {}) {
  const exports_ = {};
  const store = storage || new Map();
  const sandbox = {
    exports: exports_,
    __NOEVIA_BUILD__: build,
    fetch: fetchImpl,
    location: { href, replace: (url) => replaced.push(url) },
    history: { state: null, replaceState: (_state, _title, url) => historyReplaced.push(url) },
    sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    URL,
    Date,
  };
  vm.runInNewContext(code, sandbox);
  return { checkStaleShell: exports_.checkStaleShell, replaced, store, historyReplaced };
}

test('matching build: no reload', async () => {
  const { checkStaleShell, replaced } = load({
    build: '0.2.0',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.2.0' }) }),
  });
  await checkStaleShell();
  assert.deepEqual(replaced, []);
});

test('stale build: reloads once with a cache-busting query', async () => {
  const { checkStaleShell, replaced, store } = load({
    build: '0.2.0',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.3.0' }) }),
  });
  await checkStaleShell();
  assert.equal(replaced.length, 1);
  assert.match(replaced[0], /_shell=0\.3\.0/);
  assert.equal(store.get('noevia:shell-reload-guard'), '0.2.0->0.3.0');
});

test('same mismatch already tried this session: does not reload again (no loop)', async () => {
  const store = new Map([['noevia:shell-reload-guard', '0.2.0->0.3.0']]);
  const { checkStaleShell, replaced } = load({
    build: '0.2.0',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.3.0' }) }),
    storage: store,
  });
  await checkStaleShell();
  assert.deepEqual(replaced, []);
});

test('a new mismatch after a prior one still reloads (deploy moved on again)', async () => {
  const store = new Map([['noevia:shell-reload-guard', '0.2.0->0.3.0']]);
  const { checkStaleShell, replaced } = load({
    build: '0.2.0',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.4.0' }) }),
    storage: store,
  });
  await checkStaleShell();
  assert.equal(replaced.length, 1);
  assert.match(replaced[0], /_shell=0\.4\.0/);
});

test('network failure or non-ok response: never reloads', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, json: async () => ({ version: '0.3.0' }) }),
  ]) {
    const { checkStaleShell, replaced } = load({ build: '0.2.0', fetchImpl });
    await checkStaleShell();
    assert.deepEqual(replaced, []);
  }
});

test('lands with a leftover ?_shell= param (the reload itself): strips it via history.replaceState, no second navigation', async () => {
  const { checkStaleShell, replaced, historyReplaced } = load({
    build: '0.3.0',
    href: 'https://noevia.example/settings?_shell=0.3.0&foo=bar',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.3.0' }) }),
  });
  await checkStaleShell();
  assert.deepEqual(replaced, []); // build now matches: no reload triggered
  assert.equal(historyReplaced.length, 1);
  assert.equal(historyReplaced[0], 'https://noevia.example/settings?foo=bar');
});

test('no leftover ?_shell= param: does not touch history', async () => {
  const { checkStaleShell, historyReplaced } = load({
    build: '0.2.0',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.2.0' }) }),
  });
  await checkStaleShell();
  assert.deepEqual(historyReplaced, []);
});

test('no build stamp on this bundle: skips the check entirely (no fetch)', async () => {
  let called = false;
  const { checkStaleShell, replaced } = load({ build: '', fetchImpl: async () => { called = true; return { ok: true, json: async () => ({ version: '0.3.0' }) }; } });
  await checkStaleShell();
  assert.equal(called, false);
  assert.deepEqual(replaced, []);
});
