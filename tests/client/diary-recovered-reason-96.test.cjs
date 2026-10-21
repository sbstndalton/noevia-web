'use strict';
// #96: a recovered (reloaded) failed Diary row carries the same `code` and `reason` the live stream error
// carried (core#231). recoverDiaryTurns words it through the same diary-errors.ts mapping as the live error, so
// a reloaded chat_timeout or length_cap row shows the same sentence as live. A row without them keeps today's text.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: exports_, Intl, Number, Object, Error, String, Set, require: (m) => load(path.posix.join(path.posix.dirname(file), m).replace(/^\.\//, '')) });
  return exports_;
}
const { diaryErrorText, diaryStreamFailure } = load('diary-errors');
const { recoverDiaryTurns } = load('diary-server-recovery');
const t = (key, p = {}) => `${key}|${JSON.stringify(p)}`;
// What DiaryView passes: the live mapping, in the interface language.
const wording = (failure) => diaryErrorText(t, failure, 'en-GB');
const SERVER_TEXT = "Couldn't reach the local model — nothing was saved. You can resend.";
const row = (over = {}) => ({ id: 'ex1', message: 'Synthetic line', content: '', reasoning: '', startedAt: 5, activity: ['Generating companion response…'], state: 'failed', error: SERVER_TEXT, ...over });
const notice = (turns) => turns[1].activity.at(-1);
const live = (event) => diaryErrorText(t, diaryStreamFailure({ type: 'error', text: SERVER_TEXT, saved: false, ...event }, 'unused'), 'en-GB');

test('a recovered chat_timeout row shows the same sentence as the live error', () => {
  const turns = recoverDiaryTurns([row({ code: 'modelFailed', reason: 'chat_timeout' })], wording);
  assert.equal(notice(turns), 'diary.errors.modelTimedOut|{}');
  assert.equal(notice(turns), live({ code: 'modelFailed', reason: 'chat_timeout' }));
  assert.equal(turns[0].failed, true); assert.equal(turns[1].failed, true); assert.equal(turns[0].exchangeId, 'ex1');
});
test('a recovered length_cap row shows the same sentence as the live error', () => {
  const turns = recoverDiaryTurns([row({ code: 'modelFailed', reason: 'length_cap' })], wording);
  assert.equal(notice(turns), 'diary.errors.modelLengthCap|{}');
  assert.equal(notice(turns), live({ code: 'modelFailed', reason: 'length_cap' }));
});
test('an old row without code and reason keeps today’s text, with or without the mapping', () => {
  for (const old of [row(), row({ error: undefined })]) {
    const expected = old.error || 'Nothing was saved. You can resend.';
    assert.equal(notice(recoverDiaryTurns([old], wording)), expected);
    assert.equal(notice(recoverDiaryTurns([old])), expected);
  }
  // A row with a code but no reason (written before the reason existed) gets the generic sentence for its code, as live does.
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed' })], wording)), 'diary.errors.modelFailed|{}');
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed' })], wording)), live({ code: 'modelFailed' }));
});
test('an unknown or malformed reason gives the generic message for its code', () => {
  for (const reason of ['something_new', '', 42, null, { nested: 'chat_timeout' }]) {
    assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed', reason })], wording)), 'diary.errors.modelFailed|{}', JSON.stringify(reason));
  }
  // A reason on another code changes nothing, as on the live path.
  assert.equal(notice(recoverDiaryTurns([row({ code: 'contextFailed', reason: 'chat_timeout' })], wording)), 'diary.errors.contextFailed|{}');
  // A code this screen has no sentence for keeps the server's text.
  assert.equal(notice(recoverDiaryTurns([row({ code: 'someNewCode' })], wording)), SERVER_TEXT);
});
test('without the mapping a row keeps the server text whatever it carries (the call is backward compatible)', () => {
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelFailed', reason: 'chat_timeout' })])), SERVER_TEXT);
});
test('a row whose live sentence needs the model name keeps its own text, and rows that did not fail are untouched', () => {
  assert.equal(notice(recoverDiaryTurns([row({ code: 'modelNotServed' })], wording)), SERVER_TEXT);
  const uncertain = recoverDiaryTurns([row({ state: 'uncertain', code: 'modelFailed', reason: 'chat_timeout' })], wording);
  assert.match(notice(uncertain), /uncertain/); assert.equal(uncertain[0].failed, undefined);
  const complete = recoverDiaryTurns([row({ state: 'complete', decision: 'logged', code: 'modelFailed', reason: 'chat_timeout' })], wording);
  assert.equal(notice(complete), 'Diary entry saved.');
});
test('the Diary screen passes the live mapping when it recovers rows', () => {
  const view = fs.readFileSync(path.join(SRC, 'components/DiaryView.tsx'), 'utf8');
  assert.match(view, /recoverDiaryTurns\(exchanges,\s*failure\s*=>\s*diaryErrorText\(t,\s*failure,\s*appLocale\(\)\)\)/);
});

// Behavioural check: the real DiaryView, rendered in an isolated jsdom realm (the harness of diary-load-1510), with
// a synthetic failed row served by the recovery request. The wording on screen is the live mapping's, not the server's.
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
let bundle;
async function mountDiary(t, exchanges) {
  bundle ??= build({
    stdin: { contents: `import {act} from 'react'; import {createRoot} from 'react-dom/client'; import {DiaryView} from './src/components/DiaryView';
      const root=createRoot(document.getElementById('root'));
      export async function render(){await act(async()=>{root.render(<DiaryView active={true} inferenceUp={false}/>);await new Promise(r=>setTimeout(r,0));});}
      export async function settle(ms){await act(async()=>{await new Promise(r=>setTimeout(r,ms));});}
      export async function close(){await act(async()=>root.unmount());}`,
      resolveDir: path.resolve(__dirname, '../..'), loader: 'tsx' },
    jsx: 'automatic', bundle: true, write: false, format: 'iife', globalName: 'DiaryRecoveredFixture', platform: 'browser',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  const code = (await bundle).outputFiles[0].text;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
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
  w.fetch = async (input, init = {}) => {
    const url = String(input);
    let data = {};
    if (url === '/api/profile') data = { user: { id: 'synthetic', username: 'fixture', displayName: 'Synthetic fixture', role: 'member', diaryEnabled: true }, passkeys: [] };
    else if (url === '/api/integrations/storage') data = { kind: 'local', corpusRoot: '' };
    else if (url === '/api/diary/storage-status') data = { mode: 'legacy', backup: 'not_configured' };
    else if (url === '/api/diary/source') data = { source: 'synthetic', months: [] };
    else if (url.startsWith('/api/diary/files')) data = { files: [] };
    else if (url.startsWith('/api/diary/today')) data = { todayLog: '', standingSections: {}, memoryFiles: [] };
    else if (url.startsWith('/api/diary/exchanges')) data = { exchanges };
    else throw Error('unexpected synthetic request ' + (init.method || 'GET') + ' ' + url);
    return new w.Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  w.eval(code);
  t.after(async () => { await w.DiaryRecoveredFixture.close(); w.close(); });
  return { w, render: w.DiaryRecoveredFixture.render, settle: w.DiaryRecoveredFixture.settle };
}
// Opens today's recovered conversation and returns the text on screen.
async function screenWith(t, over) {
  const failedRow = { id: 'synthetic-exchange-0001', kind: 'capture', message: 'Synthetic question', content: '', reasoning: '', startedAt: Date.now(), activity: [], tools: [], state: 'failed', error: SERVER_TEXT, ...over };
  const f = await mountDiary(t, [failedRow]);
  await f.render(); await f.settle(50);
  const open = [...f.w.document.querySelectorAll('button')].find(b => b.textContent.includes('Open today’s conversation'));
  assert.ok(open, 'the recovered conversation is offered');
  open.click();
  await f.settle(50);
  const text = f.w.document.body.textContent;
  assert.ok(text.includes('Synthetic question'), 'the recovered exchange is on screen');
  return text;
}
const { EN_GB_DIARY } = load('i18n/diary/en-GB');

test('a reloaded chat_timeout row shows the timeout sentence on the Diary screen, not the server text', async (t) => {
  const text = await screenWith(t, { code: 'modelFailed', reason: 'chat_timeout' });
  assert.ok(text.includes(EN_GB_DIARY['diary.errors.modelTimedOut']), 'timeout sentence');
  assert.ok(!text.includes("Couldn't reach the local model"), 'the server wording is not shown');
});
test('a reloaded modelFailed row without a reason shows the generic en-GB sentence on the Diary screen', async (t) => {
  const text = await screenWith(t, { code: 'modelFailed' });
  assert.ok(text.includes(EN_GB_DIARY['diary.errors.modelFailed']), 'generic sentence');
  assert.ok(!text.includes(EN_GB_DIARY['diary.errors.modelTimedOut']), 'not the timeout sentence');
  assert.ok(!text.includes(SERVER_TEXT), 'the server wording is not shown');
});
