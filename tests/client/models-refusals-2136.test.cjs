'use strict';
// sbstndalton/noevia#2136: the Models page's LibraryTab, rendered for real in an isolated jsdom realm with synthetic responses
// (no real server, no real models). Covers its force flow (a refused unload, "Unload anyway" sending force, "Keep"), the words for
// refusals the server labels with a known code, and the "model in use" notice going once the model is no longer loaded. The
// waiting line and refused-turn wording in chat are covered by waiting-for-model-2115.test.cjs and wait-line-ends-2115.test.cjs.
// jsdom has no catalogue segment loaded, so the page's text shows as message keys here; wording per locale is checked below.
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 30000 }, fn);
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

const MODEL = 'Synthetic-Fast-Q4';
let bundle;
async function mount(t, handlers) {
  bundle ??= build({
    stdin: { contents: `import {act} from 'react'; import {createRoot} from 'react-dom/client';
      import {LibraryTab} from './src/components/models/LibraryTab';
      import {notifyModelsChanged} from './src/models-changed';
      const root=createRoot(document.getElementById('root'));
      export async function render(){await act(async()=>{root.render(<LibraryTab onConfigure={()=>{}} onChanged={()=>{}}/>);await new Promise(r=>setTimeout(r,0));});}
      export async function settle(ms){await act(async()=>{await new Promise(r=>setTimeout(r,ms));});}
      export async function changed(){await act(async()=>{notifyModelsChanged();await new Promise(r=>setTimeout(r,40));});}
      export async function click(el){await act(async()=>{el.click();await new Promise(r=>setTimeout(r,20));});}
      export async function close(){await act(async()=>root.unmount());}`,
      resolveDir: path.resolve(__dirname, '../..'), loader: 'tsx' },
    jsx: 'automatic', bundle: true, write: false, format: 'iife', globalName: 'LibraryFixture', platform: 'browser',
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
  // The notice's re-check runs every 5 s; the test runs it every 2.1 s, just past the model list's 2 s read cache.
  const realSetInterval = w.setInterval.bind(w);
  w.setInterval = (fn, ms) => realSetInterval(fn, ms === 5000 ? 2100 : ms);
  const state = { loaded: true }, posts = [];
  w.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method || 'GET';
    const reply = (status, body) => new w.Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'POST') posts.push({ url, body: JSON.parse(init.body || '{}') });
    const own = handlers(url, method, state, posts, reply);
    if (own) return own;
    if (url === '/api/models/installed') return reply(200, [{ name: MODEL, labels: [], loaded: state.loaded, sizeGB: 4, source: 'preset', canDelete: true, status: state.loaded ? 'loaded' : 'unloaded' }]);
    if (url === '/api/models/capabilities') return reply(200, { kind: 'llamacpp', admin: true, autotune: false, presets: true, download: true, runtimeOptions: false, modelManagement: true });
    if (url === '/api/model-manager/models') return reply(200, { models: [], unregistered: [] });
    if (url === '/api/model-manager/models/updates') return reply(200, { status: {} });
    return reply(200, {});
  };
  w.eval(code);
  t.after(async () => { await Promise.race([w.LibraryFixture.close(), new Promise((r) => setTimeout(r, 1000))]); w.close(); });
  await w.LibraryFixture.render();
  await w.LibraryFixture.settle(40);
  const doc = w.document, fx = w.LibraryFixture;
  const button = (label) => [...doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label);
  return { w, doc, fx, state, posts, button, notice: () => doc.querySelector('[data-testid="model-in-use"]'), alert: () => doc.querySelector('[role="alert"]')?.textContent ?? null };
}

const refuseUnload = (url, method, state, posts, reply) => url === '/api/models/unload' && method === 'POST' && !posts.at(-1).body.force
  ? reply(409, { error: 'Server English: in use.', code: 'model_in_use', retryable: true, canForce: true }) : null;

test('#2136 force flow: a refused unload offers Unload anyway, which sends force once; Keep forces nothing', async (t) => {
  const m = await mount(t, (url, method, state, posts, reply) => refuseUnload(url, method, state, posts, reply)
    || (url === '/api/models/unload' && posts.at(-1).body.force ? (state.loaded = false, reply(200, { ok: true, forced: true })) : null));
  await m.fx.click(m.button('mm.card.unloadNamed'));
  assert.ok(m.notice(), 'the in-use notice is shown');
  assert.deepEqual(m.posts.map((p) => p.body), [{ name: MODEL }], 'the first unload is a plain one');
  const [anyway, keep] = [...m.notice().querySelectorAll('button')];
  await m.fx.click(keep);
  assert.ok(!m.notice(), 'Keep closes the notice');
  assert.equal(m.posts.length, 1, 'Keep forces nothing');
  await m.fx.click(m.button('mm.card.unloadNamed'));
  assert.ok(m.notice());
  await m.fx.click([...m.notice().querySelectorAll('button')][0]);
  assert.deepEqual(m.posts.map((p) => p.body), [{ name: MODEL }, { name: MODEL }, { name: MODEL, force: true }], 'Unload anyway sends force once');
  assert.ok(!m.notice(), 'the notice goes once it is unloaded');
  assert.ok(anyway, 'the force button exists');
});

test('#2136 the notice goes when the model is no longer loaded, and stays while it is', async (t) => {
  const m = await mount(t, refuseUnload);
  await m.fx.click(m.button('mm.card.unloadNamed'));
  assert.ok(m.notice());
  await m.fx.changed();
  assert.ok(m.notice(), 'still loaded: the notice stays');
  m.state.loaded = false;
  await m.fx.settle(2500);   // the notice re-reads the list on its own timer
  assert.ok(!m.notice(), 'idle and unloaded elsewhere: the notice goes without a reload');
});

test('#2136 a notice that was shown reads the list again by itself, not only when something else changes it', async (t) => {
  const m = await mount(t, refuseUnload);
  let listed = 0;
  const original = m.w.fetch;
  m.w.fetch = (input, init) => { if (String(input) === '/api/models/installed') listed++; return original(input, init); };
  await m.fx.click(m.button('mm.card.unloadNamed'));
  const before = listed;
  await m.fx.settle(2500);
  assert.ok(listed > before, 'the list was re-read while the notice was up');
});

for (const [code, key] of [['inference_queue_full', 'mm.library.gateRefused'], ['inference_queue_timeout', 'mm.library.gateRefused'], ['gate_busy', 'mm.library.gateRefused'], ['model_in_use', 'mm.library.inUseRetry'],
  ['engine_busy', 'The local model engine is busy. Try again shortly.'], ['engine_unavailable', 'The local model engine is not answering. Try again shortly.'],
  ['engine_switch_stuck', 'The local model engine is still releasing the previous model. Try again shortly.']]) {
  // The Models catalogue segment is not loaded here, so its keys show as keys; the base catalogue's English wording shows as text.
  test(`#2136 a refused load with code ${code} reads as ${key}, never the server's text`, async (t) => {
    const m = await mount(t, (url, method) => (url === '/api/models/load' && method === 'POST' ? new Response(JSON.stringify({ error: 'Server English: refused.', code }), { status: 409, headers: { 'content-type': 'application/json' } }) : null));
    m.state.loaded = false;
    await m.fx.changed();
    await m.fx.click(m.button('mm.card.loadNamed'));
    assert.equal(m.alert(), key);
  });
}

test('#2136 a refusal with no known code still shows the server text', async (t) => {
  const m = await mount(t, (url, method) => (url === '/api/models/load' && method === 'POST' ? new Response(JSON.stringify({ error: 'Server English: something new.', code: 'some_future_code' }), { status: 409, headers: { 'content-type': 'application/json' } }) : null));
  m.state.loaded = false;
  await m.fx.changed();
  await m.fx.click(m.button('mm.card.loadNamed'));
  assert.equal(m.alert(), 'Server English: something new.');
});

test('#2136 every refusal code maps to a key every locale words, with the model name where the sentence takes one', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/models/LibraryTab.tsx'), 'utf8');
  const map = Object.fromEntries([...src.slice(src.indexOf('const REFUSALS'), src.indexOf('/** The sentence for a refusal')).matchAll(/(\w+): '([\w.]+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(map).sort(), ['engine_busy', 'engine_switch_stuck', 'engine_unavailable', 'gate_busy', 'inference_queue_full', 'inference_queue_timeout', 'model_in_use']);
  for (const locale of LOCALES) {
    const c = catalogue(locale);
    for (const [code, key] of Object.entries(map)) {
      assert.ok(c[key], `${locale} ${code}: ${key} is worded`);
      assert.doesNotMatch(c[key].replace(/\{model\}/g, ''), /\{\w+\}/, `${locale} ${key}: no other placeholder`);
    }
    assert.match(c['mm.library.inUseRetry'], /\{model\}/, `${locale}: names the model`);
  }
});
