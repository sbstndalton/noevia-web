'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const exports_={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/reply-telemetry.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exports_});
const {beginReplyTelemetry,applyReplyTelemetry,finishReplyTelemetry,lastReplyTelemetry}=exports_;

test('a reply starts unknown and first-output telemetry updates before provider usage',()=>{
 const started=beginReplyTelemetry();
 assert.deepEqual(JSON.parse(JSON.stringify(started)),{phase:'waiting',model:null,timeToFirstToken:null,inputTokens:null,outputTokens:null,totalTokens:null,tokensPerSecond:null,mtp:[]});
 const streaming=applyReplyTelemetry(started,{phase:'streaming',model:'synthetic/model',timeToFirstToken:.42});
 assert.equal(streaming.phase,'streaming');assert.equal(streaming.model,'synthetic/model');assert.equal(streaming.timeToFirstToken,.42);
 assert.equal(streaming.tokensPerSecond,null);assert.equal(streaming.inputTokens,null);
});

test('provider usage populates exact cumulative reply values and MTP without engine polling',()=>{
 const value=applyReplyTelemetry(beginReplyTelemetry('m'),{phase:'streaming',promptTokens:120,completionTokens:34,totalTokens:154,tokensPerSecond:17,drafted:40,accepted:32});
 assert.equal(value.inputTokens,120);assert.equal(value.outputTokens,34);assert.equal(value.totalTokens,154);assert.equal(value.tokensPerSecond,17);
 assert.deepEqual(JSON.parse(JSON.stringify(value.mtp)),[{model:'m',source:'last response',rate:.8,drafted:40,accepted:32}]);
 assert.equal(finishReplyTelemetry(value,'complete').phase,'complete');
});

test('missing and invalid measurements remain unknown instead of becoming zero',()=>{
 const value=applyReplyTelemetry(beginReplyTelemetry(),{promptTokens:null,completionTokens:NaN,totalTokens:-1,tokensPerSecond:0,drafted:10,accepted:11,timeToFirstToken:-2});
 assert.equal(value.inputTokens,null);assert.equal(value.outputTokens,null);assert.equal(value.totalTokens,null);assert.equal(value.tokensPerSecond,null);assert.equal(value.timeToFirstToken,null);assert.equal(value.mtp.length,0);
});

test('a later event cannot erase already reported facts',()=>{
 const measured=applyReplyTelemetry(beginReplyTelemetry('m'),{phase:'streaming',timeToFirstToken:.2,promptTokens:8,completionTokens:3,tokensPerSecond:9});
 const completed=applyReplyTelemetry(measured,{phase:'complete',timeToFirstToken:null,promptTokens:null,completionTokens:null,tokensPerSecond:null});
 assert.equal(completed.phase,'complete');assert.equal(completed.timeToFirstToken,.2);assert.equal(completed.inputTokens,8);assert.equal(completed.outputTokens,3);assert.equal(completed.tokensPerSecond,9);
});

test('stop and failure outcomes always clear the active phase',()=>{
 const active=applyReplyTelemetry(beginReplyTelemetry('m'),{phase:'streaming',timeToFirstToken:.1});
 assert.equal(finishReplyTelemetry(active,'stopped').phase,'stopped');
 assert.equal(finishReplyTelemetry(active,'error').phase,'error');
});

// #357: after a reload or navigation, replyTelemetryByChat starts empty for every chat — only the
// stored history can rehydrate the status bar's last-reply stats.
test('lastReplyTelemetry rehydrates the last completed reply from the chat\'s own stored stats',()=>{
 const messages=[
  {id:'1',role:'user',content:'hi'},
  {id:'2',role:'assistant',content:'hello',senderLabel:'gemma-4-E2B',stats:{promptTokens:12,completionTokens:8,totalTokens:20,tokensPerSecond:14}},
 ];
 const reply=lastReplyTelemetry(messages);
 assert.equal(reply.phase,'complete');
 assert.equal(reply.model,'gemma-4-E2B');
 assert.equal(reply.inputTokens,12);assert.equal(reply.outputTokens,8);assert.equal(reply.totalTokens,20);assert.equal(reply.tokensPerSecond,14);
 // Never measured or stored per message — an honest "not reported" beats a fabricated number.
 assert.equal(reply.timeToFirstToken,null);
 assert.deepEqual(JSON.parse(JSON.stringify(reply.mtp)),[]);
});

test('lastReplyTelemetry shows a neutral placeholder rather than fabricating a reply',()=>{
 assert.equal(lastReplyTelemetry([]),null,'no messages at all');
 assert.equal(lastReplyTelemetry([{id:'1',role:'user',content:'hi'}]),null,'awaiting a reply, not one that failed');
 assert.equal(lastReplyTelemetry([{id:'1',role:'assistant',content:'hi'}]),null,'no stats recorded for this message');
 assert.equal(lastReplyTelemetry([{id:'1',role:'assistant',content:'hi',stats:{}}]),null,'an empty stats object is not a real measurement');
 // Only the very last message describes the chat's current reply (mirrors currentRoutingDecision).
 const stale=[{id:'1',role:'assistant',content:'old',stats:{tokensPerSecond:9}},{id:'2',role:'user',content:'again'}];
 assert.equal(lastReplyTelemetry(stale),null);
});
