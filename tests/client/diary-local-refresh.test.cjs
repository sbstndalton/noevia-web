'use strict';
// Actual ReactDOM effects in an isolated jsdom browser realm; no real folder/network/account.
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest(name, {timeout:10000}, fn);
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { build } = require('esbuild');
let bundle;
async function mounted(t, options = {}) {
  bundle ??= build({ stdin: { contents: `import {act} from 'react'; import {createRoot} from 'react-dom/client'; import {DiaryView} from './src/components/DiaryView';
    const root=createRoot(document.getElementById('root')); export async function render(active=true){await act(async()=>{root.render(<DiaryView active={active} inferenceUp={false}/>);await new Promise(r=>setTimeout(r,0));});}
    export async function action(fn){await act(async()=>{await fn();await new Promise(r=>setTimeout(r,0));});} export async function close(){await act(async()=>root.unmount());}`,
    resolveDir: path.resolve(__dirname, '../..'), loader: 'tsx' }, jsx:'automatic', bundle:true, write:false, format:'iife', globalName:'DiaryFixture', platform:'browser', loader:{'.css':'empty'}, define:{'process.env.NODE_ENV':'"test"'}, logLevel:'silent' });
  const code=(await bundle).outputFiles[0].text;
  const dom=new JSDOM('<!doctype html><div id="root"></div>', {url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window; const calls=[];
  w.IS_REACT_ACT_ENVIRONMENT=true;
  w.MessageChannel=class {constructor(){this.port1={onmessage:null};this.port2={postMessage:()=>w.setTimeout(()=>this.port1.onmessage?.(),0)};}};
  // Narrow Web API polyfills only; Node globals are never replaced with jsdom globals.
  for(const key of ['Headers','Response','TextEncoder','TextDecoder','ReadableStream'])w[key]=globalThis[key];
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;}; w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.HTMLElement.prototype.scrollIntoView=function(){}; w.HTMLElement.prototype.scrollTo=function(){};
  w.ResizeObserver=class {observe(){} disconnect(){}};
  w.setInterval=()=>0; w.clearInterval=()=>{};
  let visible=true; Object.defineProperty(w.document,'visibilityState',{get:()=>visible?'visible':'hidden'});
  w.fetch=async(input,init={})=>{
    const url=String(input),method=init.method||'GET'; calls.push({url,method});
    assert.equal(method,'GET','refresh must never write, sync or send chat');
    let data={};
    if(url==='/api/profile')data={user:{id:'synthetic',username:'fixture',displayName:'Synthetic fixture',role:'member',diaryEnabled:true},passkeys:[]};
    else if(url==='/api/integrations/storage')data={kind:'local',corpusRoot:''};
    else if(url==='/api/diary/storage-status')data={mode:'legacy',backup:'not_configured'};
    else if(url==='/api/diary/source')data={months:[]};
    else if(url.startsWith('/api/diary/files'))data={files:[]};
    else if(url==='/api/diary/today')data={todayLog:'',standingSections:{},memoryFiles:[]};
    else if(url.startsWith('/api/diary/exchanges'))data={exchanges:[]};
    else throw Error('unexpected synthetic GET '+url);
    return new w.Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  };
  w.eval(code);
  t.after(async()=>{await w.DiaryFixture.close();w.close();});
  const action=w.DiaryFixture.action;
  const click=async(label)=>action(()=>{const button=[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);assert.ok(button,'button '+label);assert.equal(button.disabled,false,label);button.click();});
  const handles=[];
  function folder(initial={'today.md':'# Original'}) {
    const state={files:{...initial},scans:0,permission:'granted',prompts:0,writes:0,gate:null};
    const handle={kind:'directory',name:'synthetic',async isSameEntry(other){return other===handle;},async queryPermission(){return state.permission;},async requestPermission(){state.prompts++;return state.permission;},async *values(){state.scans++;const snapshot=Object.entries(state.files);if(state.gate)await state.gate;for(const [name,text] of snapshot)yield {kind:'file',name,async getFile(){return {size:new TextEncoder().encode(text).length,async text(){return text;}}},async createWritable(){state.writes++;throw Error('no synthetic writes allowed');}};},async getDirectoryHandle(){throw Error('no nested fixture');},async getFileHandle(){state.writes++;throw Error('no writes');}};
    handles.push(state);return {handle,state};
  }
  async function connect(f){w.showDirectoryPicker=async()=>f.handle;await click('Edit');await action(()=>{[...w.document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Browser folder')).click();});await click('Choose folder');}
  const records=[];let recovered, finishRecovery, recoveryReads=0;const recoveryFinished=new Promise(resolve=>{finishRecovery=resolve;});
  if(options.pending){
    recovered=folder();w.showDirectoryPicker=async()=>recovered.handle;
    records.push({id:'original-recovery',owner:'synthetic',updatedAt:1,folder:recovered.handle,state:{draft:'',day:'2026-10-11',month:'2026-10',turns:{'2026-10-11':[{role:'user',content:'Synthetic preserved history'}]},pendingLocal:options.pending==='local'?{'today.md':{before:'# Original',content:'# Pending local'}}:{},pendingSync:options.pending==='sync'?{'today.md':{before:'# Original',content:'# Pending sync'}}:{},editor:null,editText:'',interrupted:false,storageIdentity:'["local",null,null,null,""]'}});
  }
  // A tiny synthetic IndexedDB transport exercises the actual recovery module and route to
  // pending state; it does not intercept React hooks or manufacture component state.
  w.indexedDB={open(){const request={};w.setTimeout(()=>{request.result={close(){},transaction(){const tx={objectStore(){return {getAll(){const r={};w.setTimeout(()=>{r.result=records.slice();r.onsuccess?.();if(++recoveryReads===2)finishRecovery();},0);return r;},get(id){const r={};w.setTimeout(()=>{r.result=records.find(x=>x.id===id);r.onsuccess?.();w.setTimeout(()=>tx.oncomplete?.(),0);},0);return r;},put(record){const i=records.findIndex(x=>x.id===record.id);if(i>=0)records[i]=record;else records.push(record);w.setTimeout(()=>tx.oncomplete?.(),0);},delete(id){const i=records.findIndex(x=>x.id===id);if(i>=0)records.splice(i,1);}};}};return tx;}};request.onsuccess?.();},0);return request;}};
  await w.DiaryFixture.render();
  const input=async(selector,value)=>action(()=>{const field=w.document.querySelector(selector);assert.ok(field,selector);const prototype=field.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,value);field.dispatchEvent(new w.Event('input',{bubbles:true}));});
  return {w,click,action,input,folder,connect,calls,handles,records,recovered,recoveryFinished,render:w.DiaryFixture.render,visible:async(value)=>{visible=value;await action(()=>w.document.dispatchEvent(new w.Event('visibilitychange')));}};
}

test('#1309 mounted activation refreshes retained local snapshot (changed/added/removed)',async(t)=>{
  const f=await mounted(t),local=f.folder();await f.connect(local);
  assert.ok(f.w.document.querySelector('[title="today.md"]'));
  await f.render(false);local.state.files={'changed.md':'# Changed','added.md':'# Added'};await f.render(true);
  assert.ok(f.w.document.querySelector('[title="added.md"]'),'activation must rescan the retained handle');
  assert.equal(f.w.document.querySelector('[title="today.md"]'),null);
  assert.equal(local.state.writes,0);assert.equal(local.state.prompts,0);
});


test('#1309 mounted focus/visibility/manual refresh read changed text without replacing the clean editor base',async(t)=>{
  const f=await mounted(t),local=f.folder();await f.connect(local);await f.click('today.md');
  // Select the actual editor by its content, independent of layout/translated labels.
  const text=()=>[...f.w.document.querySelectorAll('textarea')].find(e=>e.value==='# Original');
  assert.ok(text());local.state.files['extra.md']='# Extra';
  await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  assert.ok(f.w.document.querySelector('[title="extra.md"]'));
  assert.ok(text(),'editor working copy and original version base remain unchanged');
  local.state.files={'new.md':'# New'};await f.visible(false);await f.visible(true);
  assert.ok(f.w.document.querySelector('[title="new.md"]'));
  local.state.files['manual.md']='# Manual';await f.click('Refresh files');
  assert.ok(f.w.document.querySelector('[title="manual.md"]'));
  assert.equal(local.state.writes,0);assert.equal(local.state.prompts,0);
});

test('#1309 mounted permission denial never prompts and existing Retry rescans after permission returns',async(t)=>{
  const f=await mounted(t),local=f.folder();await f.connect(local);const scans=local.state.scans;
  local.state.permission='denied';await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  assert.equal(local.state.scans,scans);assert.equal(local.state.prompts,0);
  assert.ok(f.w.document.querySelector('[role="alert"]'));
  local.state.permission='granted';local.state.files={'retry.md':'# Retry'};
  const retry=[...f.w.document.querySelectorAll('button')].find(b=>/Retry/.test(b.textContent));assert.ok(retry);
  await f.action(()=>retry.click());assert.ok(f.w.document.querySelector('[title="retry.md"]'));
});

test('#1309 mounted dirty editor and capture draft block refresh and preserve original content',async(t)=>{
  const f=await mounted(t),local=f.folder();await f.connect(local);await f.click('today.md');
  const field=[...f.w.document.querySelectorAll('textarea')].find(e=>e.value==='# Original');assert.ok(field);field.id='synthetic-editor';
  await f.input('#synthetic-editor','# Unsaved');const scans=local.state.scans;
  local.state.files={'outside.md':'# Outside'};await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  assert.equal(local.state.scans,scans);assert.equal(field.value,'# Unsaved');assert.equal(f.w.document.querySelector('[title="outside.md"]'),null);
  assert.match(f.w.document.body.textContent,/Unsaved changes/);
  await f.input('#synthetic-editor','# Original');await f.input('#diary-draft','Unsent synthetic draft');
  await f.render(false);await f.render(true);assert.equal(local.state.scans,scans);assert.equal(f.w.document.querySelector('#diary-draft').value,'Unsent synthetic draft');
  assert.equal(local.state.writes,0);
});

test('#1309 mounted overlapping focus scans coalesce; mid-scan edit invalidates result',async(t)=>{
  const f=await mounted(t),local=f.folder();await f.connect(local);await f.click('today.md');
  const field=[...f.w.document.querySelectorAll('textarea')].find(e=>e.value==='# Original');field.id='synthetic-editor';
  let release;local.state.gate=new Promise(r=>{release=r;});const scans=local.state.scans;
  await f.action(()=>{f.w.dispatchEvent(new f.w.Event('focus'));f.w.dispatchEvent(new f.w.Event('focus'));});
  assert.equal(local.state.scans,scans+1);
  await f.input('#synthetic-editor','# Mid-scan edit');local.state.files={'stale.md':'# Must not apply'};
  await f.action(()=>release());local.state.gate=null;
  assert.equal(field.value,'# Mid-scan edit');assert.equal(f.w.document.querySelector('[title="stale.md"]'),null);
  assert.equal(local.state.writes,0);
});

test('#1309 mounted hidden and disconnected scans cannot apply old handles after reconnect',async(t)=>{
  const f=await mounted(t),old=f.folder();await f.connect(old);
  let release;old.state.gate=new Promise(r=>{release=r;});
  await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  await f.visible(false);old.state.files={'old-stale.md':'# Old'};await f.action(()=>release());old.state.gate=null;
  assert.equal(f.w.document.querySelector('[title="old-stale.md"]'),null);
  await f.visible(true);
  // The original same-ID retained handle remains usable after cancellation.
  assert.ok(f.w.document.querySelector('[title="old-stale.md"]'));
  await f.click('Return to Server storage');
  const next=f.folder({'new-folder.md':'# New folder'});await f.connect(next);
  assert.ok(f.w.document.querySelector('[title="new-folder.md"]'));assert.equal(f.w.document.querySelector('[title="old-stale.md"]'),null);
  assert.equal(old.state.writes+next.state.writes,0);
});


for(const pending of ['local','sync'])test(`#1309 mounted recovered ${pending} pending saves retain before/content and turns without scan/write/sync`,async(t)=>{
  const f=await mounted(t,{pending});
  // Bounded event flush lets the actual profile + recovery read complete.
  await f.action(()=>new Promise(r=>f.w.setTimeout(r,10)));
  await f.click('Reconnect & recover');await f.action(()=>f.recoveryFinished);const local=f.recovered;
  const snapshot=JSON.stringify(f.records.map(r=>r.state));const scans=local.state.scans;
  assert.match(f.w.document.body.textContent,/Synthetic preserved history/);
  local.state.files={'outside.md':'# Outside'};await f.render(false);await f.render(true);await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  assert.equal(local.state.scans,scans,'pending work must block the scan');
  assert.equal(JSON.stringify(f.records.map(r=>r.state)),snapshot,'pending before/content/history records unchanged');
  assert.equal(f.w.document.querySelector('[title="outside.md"]'),null);assert.equal(local.state.writes,0);
  assert.ok(f.calls.every(c=>c.method==='GET'));
});


test('#1309 mounted rapid hide/resume discards the older snapshot before it completes',async(t)=>{
  const f=await mounted(t),local=f.folder();await f.connect(local);
  let release;local.state.gate=new Promise(r=>{release=r;});const scans=local.state.scans;
  await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  await f.visible(false);local.state.files={'resumed.md':'# Resumed'};await f.visible(true);
  assert.equal(local.state.scans,scans+2,'resume must replace the invalidated in-flight read');
  await f.action(()=>release());local.state.gate=null;
  assert.ok(f.w.document.querySelector('[title="resumed.md"]'));assert.equal(f.w.document.querySelector('[title="today.md"]'),null);
});

test('#1309 mounted disconnect/reconnect while old read is suspended preserves the new folder',async(t)=>{
  const f=await mounted(t),old=f.folder();await f.connect(old);
  let release;old.state.gate=new Promise(r=>{release=r;});await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  await f.click('Return to Server storage');const next=f.folder({'new-folder.md':'# New'});await f.connect(next);
  await f.action(()=>release());old.state.gate=null;
  assert.ok(f.w.document.querySelector('[title="new-folder.md"]'));assert.equal(f.w.document.querySelector('[title="today.md"]'),null);
  assert.equal(old.state.writes+next.state.writes,0);
});

test('#1309 mounted an explicit file read busy gate blocks refresh without extra scanning',async(t)=>{
  const f=await mounted(t),local=f.folder();await f.connect(local);
  let release;local.state.gate=new Promise(r=>{release=r;});const scans=local.state.scans;
  await f.click('today.md');await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  assert.equal(local.state.scans,scans+1,'the busy file operation owns the only read');
  await f.action(()=>release());local.state.gate=null;
  assert.equal(local.state.writes,0);assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('#1309 mounted rescan updates changed day text in the derived view',async(t)=>{
  const f=await mounted(t),now=new f.w.Date();
  const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const local=f.folder({[today+'.md']:'# Original derived text'});await f.connect(local);
  await f.action(()=>f.w.document.querySelector('.calendar-today').click());
  assert.match(f.w.document.querySelector('.diary-saved-record').textContent,/Original derived text/);
  local.state.files[today+'.md']='# Changed external text';await f.action(()=>f.w.dispatchEvent(new f.w.Event('focus')));
  assert.match(f.w.document.querySelector('.diary-saved-record').textContent,/Changed external text/);
  assert.equal(local.state.writes,0);
});
