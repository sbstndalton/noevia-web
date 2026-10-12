'use strict';
// #1510: the Diary overview starts its reads together and asks for each month once. Rendered through the
// real DiaryView in an isolated jsdom realm, with synthetic month logs (no real Diary data). The source
// list and the root folder listing must be in flight at the same time, and a month that is both a recent
// month and the selected one is requested once.
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 20000 }, fn);
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');

let bundle;
async function mountDiary(t, { sourceGate = null } = {}) {
  bundle ??= build({
    stdin: { contents: `import {act} from 'react'; import {createRoot} from 'react-dom/client'; import {DiaryView} from './src/components/DiaryView';
      const root=createRoot(document.getElementById('root'));
      export async function render(){await act(async()=>{root.render(<DiaryView active={true} inferenceUp={false}/>);await new Promise(r=>setTimeout(r,0));});}
      export async function settle(ms){await act(async()=>{await new Promise(r=>setTimeout(r,ms));});}
      export async function close(){await act(async()=>root.unmount());}`,
      resolveDir: path.resolve(__dirname, '../..'), loader: 'tsx' },
    jsx: 'automatic', bundle: true, write: false, format: 'iife', globalName: 'DiaryLoadFixture', platform: 'browser',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  const code = (await bundle).outputFiles[0].text;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  w.IS_REACT_ACT_ENVIRONMENT = true;
  w.MessageChannel = class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => w.setTimeout(() => this.port1.onmessage?.(), 0) }; } };
  for (const key of ['Headers', 'Response', 'TextEncoder', 'TextDecoder', 'ReadableStream']) w[key] = globalThis[key];
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLElement.prototype.scrollTo = function () {};
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.setInterval = () => 0; w.clearInterval = () => {};
  w.indexedDB = undefined;
  let filesCalls = 0;
  const sourceStarted = { at: null };
  let sourceFinished = false, filesBeforeSourceFinished = false;
  w.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method || 'GET';
    calls.push({ url, method });
    assert.equal(method, 'GET', 'the Diary overview never writes');
    let data = {};
    if (url === '/api/profile') data = { user: { id: 'synthetic', username: 'fixture', displayName: 'Synthetic fixture', role: 'member', diaryEnabled: true }, passkeys: [] };
    else if (url === '/api/integrations/storage') data = { kind: 'local', corpusRoot: '' };
    else if (url === '/api/diary/storage-status') data = { mode: 'legacy', backup: 'not_configured' };
    else if (url === '/api/diary/source') {
      sourceStarted.at = calls.length;
      if (sourceGate) await sourceGate(() => filesCalls);
      sourceFinished = true;
      // The two most recent months include the current one, which the overview also shows by default.
      const now = new Date(), cur = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1), prev = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
      data = { source: 'synthetic', months: [{ id: prev, label: prev }, { id: cur, label: cur }] };
    } else if (url.startsWith('/api/diary/files')) {
      filesCalls += 1;
      if (!sourceFinished) filesBeforeSourceFinished = true;
      data = { files: [] };
    } else if (url.startsWith('/api/diary/today')) {
      const month = new URL(url, 'http://localhost').searchParams.get('month') || '';
      data = { todayLog: `## Synthetic ${month}\n\nSynthetic entry for ${month}.`, standingSections: {}, memoryFiles: [] };
    } else if (url.startsWith('/api/diary/exchanges')) data = { exchanges: [] };
    else throw Error('unexpected synthetic GET ' + url);
    return new w.Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  w.eval(code);
  t.after(async () => { await w.DiaryLoadFixture.close(); w.close(); });
  return { w, calls, render: w.DiaryLoadFixture.render, settle: w.DiaryLoadFixture.settle, filesBeforeSourceFinished: () => filesBeforeSourceFinished };
}

test('#1510 the source list and the root listing start together, not one after the other', async (t) => {
  // The source read waits until the folder listing has started (or gives up after 200 ms). A sequential
  // overview never starts the listing while the source is pending, so the flag stays false.
  const fixture = await mountDiary(t, {
    sourceGate: async (filesStarted) => {
      for (let i = 0; i < 40 && filesStarted() === 0; i += 1) await new Promise(r => setTimeout(r, 5));
    },
  });
  await fixture.render();
  await fixture.settle(50);
  assert.equal(fixture.filesBeforeSourceFinished(), true, 'the folder listing waited for the source read');
});

test('#1510 each month is requested once per load, even when it is both recent and selected', async (t) => {
  const fixture = await mountDiary(t);
  await fixture.render();
  await fixture.settle(50);
  const todayCalls = fixture.calls.filter(c => c.url.startsWith('/api/diary/today'));
  const byMonth = {};
  for (const c of todayCalls) { const m = new URL(c.url, 'http://localhost').searchParams.get('month') || ''; byMonth[m] = (byMonth[m] || 0) + 1; }
  for (const [month, n] of Object.entries(byMonth)) assert.equal(n, 1, `month ${month} was requested ${n} times`);
  assert.equal(fixture.calls.filter(c => c.url === '/api/diary/source').length, 1, 'the month list is read once');
});
