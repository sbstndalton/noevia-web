'use strict';
// #2267: the Models settings sections' load() never cleared its error on success, so a passing 503
// stayed on screen beside fresh data. Rendered through the real sections in an isolated jsdom realm
// with synthetic responses (no real settings).
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');

let bundle;
async function mount(t, section, routes) {
  bundle ??= build({
    stdin: { contents: `import {act} from 'react'; import {createRoot} from 'react-dom/client';
      import {InferenceBudgetSection, IdleUnloadSection} from './src/components/models/ModelsSettings';
      import {notifyModelsChanged} from './src/models-changed';
      const root=createRoot(document.getElementById('root'));
      export async function render(name){await act(async()=>{root.render(name==='budget'?<InferenceBudgetSection/>:<IdleUnloadSection/>);await new Promise(r=>setTimeout(r,0));});}
      export async function settle(ms){await act(async()=>{await new Promise(r=>setTimeout(r,ms));});}
      export async function changed(){await act(async()=>{notifyModelsChanged();await new Promise(r=>setTimeout(r,20));});}
      export async function close(){await act(async()=>root.unmount());}`,
      resolveDir: path.resolve(__dirname, '../..'), loader: 'tsx' },
    jsx: 'automatic', bundle: true, write: false, format: 'iife', globalName: 'ModelsFixture', platform: 'browser',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  const code = (await bundle).outputFiles[0].text;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.IS_REACT_ACT_ENVIRONMENT = true;
  w.MessageChannel = class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }; } };
  for (const key of ['Headers', 'Response', 'TextEncoder', 'TextDecoder', 'ReadableStream']) w[key] = globalThis[key];
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.indexedDB = undefined;
  const calls = [];
  w.fetch = async (input, init = {}) => {
    const key = `${init.method || 'GET'} ${String(input)}`;
    if (String(input) === '/api/account/preferences') return new w.Response('{}', { headers: { 'content-type': 'application/json' } });
    calls.push(key);
    const next = routes[key]?.shift();
    if (!next) throw Error('unexpected synthetic request ' + key);
    return new w.Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  };
  w.eval(code);
  t.after(async () => { await w.ModelsFixture.close(); w.close(); });
  await w.ModelsFixture.render(section);
  await w.ModelsFixture.settle(30);
  return { w, calls, alert: () => w.document.querySelector('[role="alert"]')?.textContent ?? null, fx: w.ModelsFixture };
}

const budget = { budgetGib: 6, source: 'deployment', defaultGib: 6, minGib: 2, maxGib: 60, models: [] };
const idle = { seconds: 300, source: 'default', fallbackSeconds: null, fallbackSource: null, defaultSeconds: 300, minSeconds: 60, maxSeconds: 86400, applied: true };

test('#2267 the budget section drops a failed load once a later load works', async (t) => {
  const m = await mount(t, 'budget', { 'GET /api/models/inference-budget': [{ status: 503, body: {} }, { status: 200, body: budget }] });
  assert.match(m.alert() ?? '', /./, 'the failed load is shown');
  await m.fx.changed();
  assert.equal(m.alert(), null, 'the error is gone beside the fresh data');
  assert.equal(m.w.document.querySelector('select, input')?.value !== undefined, true);
});

test('#2267 the idle-unload section keeps a save error that a following load must not wipe', async (t) => {
  const m = await mount(t, 'idle', {
    'GET /api/models/idle-unload': [{ status: 200, body: idle }, { status: 200, body: { ...idle, seconds: 600, source: 'setting' } }],
    'PUT /api/models/idle-unload': [{ status: 200, body: { apply: { state: 'failed' } } }],
  });
  const select = m.w.document.querySelector('select');
  select.value = '600';
  select.dispatchEvent(new m.w.Event('change', { bubbles: true }));
  await m.fx.settle(10);
  const save = [...m.w.document.querySelectorAll('button')].find((b) => !b.disabled && b.classList.contains('primary'));
  assert.ok(save, 'Save is offered for a changed value');
  save.click();
  await m.fx.settle(40);
  assert.deepEqual(m.calls, ['GET /api/models/idle-unload', 'PUT /api/models/idle-unload', 'GET /api/models/idle-unload']);
  assert.match(m.alert() ?? '', /mm\.idle\.savedFailed/, 'Saved, but the settings file failed: still shown after the reload');
});
