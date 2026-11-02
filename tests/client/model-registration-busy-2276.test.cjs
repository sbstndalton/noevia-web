'use strict';
// Run the real registration helper against the preset-write busy contract. No engine or browser network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/components/models/register.ts'), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const TRIED = 'noevia:models-folder-sync-tried';
function fixture({ busy = true, conflict = false } = {}) {
  const values = new Map([[TRIED, JSON.stringify(['other'])]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = { busy, writes: 0, reloads: 0 };
  const translate = (key, params) => key+' '+JSON.stringify(params ?? {});
  const imports = {
    '../../api': { apiFetch: async () => { state.reloads++; return { ok: true, status: 200, json: async () => ({}) }; } },
    './mm': { mm: async () => {
      state.writes++;
      if (state.busy) throw Object.assign(Error('Models are busy; nothing was written.'), { status: 409, code: conflict ? undefined : 'modelsBusy', errorId: conflict ? undefined : 'modelsBusy' });
      return {};
    }, errorText: (e, fallback) => e instanceof Error ? e.message : fallback },
    '../../i18n': { interfaceLocale: () => 'en-GB', t: translate },
    '../../i18n/core': { translatePlural: (_locale, key, count) => key+':'+count },
  };
  const mod = { exports: {} };
  new Function('module','exports','require','sessionStorage','localStorage',code)(mod,mod.exports,id => { assert.ok(imports[id],id); return imports[id]; },storage,storage);
  return { api: mod.exports, state, values };
}

test('manual registration never reports a busy refusal as registered and does not reload', async () => {
  const f = fixture();
  const refused = await f.api.registerSafeDefaults('later');
  assert.equal(refused.registered, false);
  assert.match(refused.text, /Models are busy/);
  assert.equal(f.state.reloads, 0);
  f.state.busy = false;
  assert.equal((await f.api.registerSafeDefaults('later')).registered, true);
  assert.equal(f.state.reloads, 1);
});

test('automatic registration keeps a busy file retryable without forgetting other tried files', async () => {
  const f = fixture();
  const refused = await f.api.registerNewFolderModels(['later']);
  assert.deepEqual(refused.added, []);
  assert.match(refused.text, /Models are busy/);
  assert.deepEqual(JSON.parse(f.values.get(TRIED)), ['other']);
  assert.equal(f.state.reloads, 0);
  f.state.busy = false;
  assert.deepEqual((await f.api.registerNewFolderModels(['later'])).added, ['later']);
  assert.deepEqual(JSON.parse(f.values.get(TRIED)), ['other','later']);
  assert.equal(f.state.reloads, 1);
  await f.api.registerNewFolderModels(['later']);
  assert.equal(f.state.writes, 2, 'successful registration stays tried');
});

test('an ordinary already-registered revision conflict retains its existing contract', async () => {
  const f = fixture({ conflict: true });
  assert.deepEqual(await f.api.registerSafeDefaults('present'), { registered: true, text: '' });
  assert.equal(f.state.reloads, 0);
});
