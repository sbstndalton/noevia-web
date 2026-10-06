'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../src/api.ts'),'utf8');
const fn=source.slice(source.indexOf('export interface UploadProgress'),source.indexOf('/** Delete one source'));
const js=ts.transpileModule(fn.replace(/export /g,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
test('upload transfer progress, CSRF, server processing and completion remain distinct',async()=>{
 const events=[],headers={};let body;let calls=0;let invalidations=0;
 class XHR {
  upload={};status=202;responseText=JSON.stringify({poll:'/fixture/job'});
  open(method,url){assert.equal(method,'POST');assert.match(url,/background=1/);}
  setRequestHeader(k,v){headers[k]=v;}
  send(data){body=JSON.parse(data);this.upload.onprogress({lengthComputable:true,loaded:5,total:10});this.onload();}
 }
 const ctx={WORKSPACE_KEY:'workspace',invalidateCached:key=>{assert.equal(key,'workspace');assert.equal(calls,2);invalidations++;},clearRequestCache:()=>{},XMLHttpRequest:XHR,cookie:()=> 'synthetic-csrf',setTimeout:fn=>fn(),hasApiMajorMismatchHeader:()=>false,API_MAJOR:'1',window:{dispatchEvent(){}},getJson:async url=>{assert.equal(url,'/fixture/job');return ++calls===1?{done:false,stage:'Extracting PDF text / OCR'}:{done:true,status:200,body:{name:'fixture.docx'}};}};
 vm.createContext(ctx);vm.runInContext(js,ctx);
 await ctx.uploadProjectFile('fixture',{name:'fixture.docx',dataBase64:'cWE='},p=>events.push(p));
 assert.equal(headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(body.organized,true);
 assert.equal(events[0].percent,50);assert.ok(events.some(e=>e.stage==='Extracting PDF text / OCR'));
 assert.equal(events.at(-1).stage,'Saved');assert.equal(invalidations,1);
});
