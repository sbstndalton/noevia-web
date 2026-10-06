const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const result={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/diary-local-recovery.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:result,TextEncoder});
const fixture=()=>({draft:'unfinished',day:'2026-09-13',month:'2026-09',turns:{'2026-09-13':[{role:'assistant',content:'reply',tools:[{name:'write',args:'proposal',status:'pending',approvalId:'obsolete'},{name:'read',args:'result',status:'done'}]}]},pendingLocal:{'entry.md':{before:null,content:'new text'}},pendingSync:{'old.md':{before:'old',content:'replacement'}},editor:{path:'edit.md',content:'before',version:null},editText:'unsaved edit',interrupted:true,storageIdentity:'synthetic'});
test('local recovery preserves draft and conflict baselines but cannot restore live approvals',()=>{
 const input=fixture(),safe=result.restoredLocalState(input),turn=safe.turns[input.day][0];
 assert.deepEqual(JSON.parse(JSON.stringify(safe.pendingLocal)),input.pendingLocal);
 assert.deepEqual(JSON.parse(JSON.stringify(safe.pendingSync)),input.pendingSync);
 assert.equal(safe.editText,'unsaved edit');assert.equal(safe.draft,'unfinished');
 assert.equal(turn.tools[0].status,'denied');assert.equal(turn.tools[0].approvalId,undefined);
 assert.equal(turn.tools[1].status,'done');assert.match(turn.activity.at(-1),/nothing was resent/);
 assert.equal(input.turns[input.day][0].tools[0].status,'pending','original in-flight approval is unchanged');
});
test('oversize recovery fails explicitly without silently dropping pending saves',()=>{
 const input=fixture();input.pendingLocal['large.md']={before:null,content:'é'.repeat(3*1024*1024)};
 assert.throws(()=>result.recoveryState(input),/exceeds 4 MB/);
 assert.equal(input.pendingLocal['large.md'].content.length,3*1024*1024);
});
