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
