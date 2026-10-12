const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const result={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/diary-server-recovery.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:result});
const prep={id:'prep',kind:'preparation',message:'Synthetic prompt',content:'Reference only',reasoning:'Preparation reasoning',startedAt:1,activity:['Tool preparation'],state:'complete',tools:[{name:'read',args:'result',status:'done'},{name:'write',args:'synthetic',status:'pending',approvalId:'MUST-NOT-RESTORE'}]};
test('pairs optional preparation with capture without duplicate prompts or actionable approvals',()=>{
 const capture={id:'capture',preparationId:'prep',message:prep.message,content:'Companion answer',reasoning:'Companion reasoning',startedAt:2,activity:['Capture'],state:'complete',decision:'logged'};
 const turns=result.recoverDiaryTurns([prep,capture]);assert.equal(turns.length,2);assert.equal(turns[1].content,'Companion answer');assert.match(turns[1].reasoning,/Preparation reasoning/);assert.match(turns[1].reasoning,/Companion reasoning/);
 assert.equal(turns[1].tools[1].status,'denied');assert.equal(JSON.stringify(turns).includes('MUST-NOT-RESTORE'),false);
});
test('unlinked preparation never presents reference output as a companion answer or save',()=>{
 const turns=result.recoverDiaryTurns([{...prep,state:'uncertain'}]);assert.equal(turns.length,2);assert.equal(turns[1].content,'');assert.match(turns[1].activity.at(-1),/No diary entry was sent/);
});
// #1422: a failure the server proves left nothing saved is `failed` (shown, resendable, never history);
// an uncertain one that the person reviewed says so instead of raising the same warning again.
const sendState=(over)=>({id:'ex1',message:'Synthetic line',content:'',reasoning:'',startedAt:5,activity:['Generating companion response…'],...over});
test('a failed exchange reads "nothing was saved" with the server wording and is flagged out of history',()=>{
 const turns=result.recoverDiaryTurns([sendState({state:'failed',code:'modelFailed',error:"Couldn't reach the local model — nothing was saved. You can resend."})]);
 assert.equal(turns.length,2);assert.equal(turns[0].exchangeId,'ex1');assert.equal(turns[0].failed,true);assert.equal(turns[1].failed,true);
 assert.match(turns[1].activity.at(-1),/nothing was saved/);assert.doesNotMatch(JSON.stringify(turns),/uncertain/i);
 const conversation={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/diary-conversation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:conversation,require:()=>({appliedCalls:()=>[],localDay:()=>'2026-10-12',localTimestamp:()=>'x'})});
 assert.equal(JSON.stringify(conversation.diaryHistory([{role:'user',content:'earlier'},{role:'assistant',content:'earlier answer'},...turns])),JSON.stringify([{role:'user',content:'earlier'},{role:'assistant',content:'earlier answer'}]));
});
test('an uncertain exchange keeps the check-the-diary warning until it is reviewed, then says it was reviewed',()=>{
 const open=result.recoverDiaryTurns([sendState({state:'uncertain'})]);
 assert.match(open[1].activity.at(-1),/uncertain/);assert.equal(open[0].failed,undefined);assert.equal(open[0].exchangeId,'ex1');
 const reviewed=result.recoverDiaryTurns([sendState({state:'uncertain',acknowledgedAt:1})]);
 assert.match(reviewed[1].activity.at(-1),/reviewed/);assert.doesNotMatch(reviewed[1].activity.at(-1),/before sending again/);
});
