const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../../src/model-guidance.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports_={};vm.runInNewContext(code,{exports:exports_});
const {memoryAssessment:assess,matchesModelUse:matches,modelChoiceLabel:label}=exports_;
const plan={capacityGB:'16',reserveGB:'4',kind:'gpu'};
test('memory guidance never adds system RAM to GPU or double-counts unified memory',()=>{
 assert.equal(assess(8,plan).remainingGB,4);
 for(const kind of ['gpu','unified','cpu'])assert.equal(assess(8,{...plan,kind}).remainingGB,4);
 assert.equal(assess(13,plan).state,'over');assert.equal(assess(11.5,plan).state,'tight');assert.equal(assess(8,plan).state,'room');
});
test('unknown sizes, invalid budgets and absent capacity never become recommended fit',()=>{
 for(const size of [null,undefined,0,-1,NaN,Infinity])assert.equal(assess(size,plan).state,'unknown');
 for(const capacityGB of ['', ' ', '-4','Infinity','hello','5000'])assert.equal(assess(8,{...plan,capacityGB}).state,'unknown');
 for(const reserveGB of ['', ' ', '-1','16','17','Infinity'])assert.equal(assess(8,{...plan,reserveGB}).state,'unknown');
 assert.match(assess(8,plan).detail,/needs verification/);
});
test('capability guidance uses explicit labels, not model-size or name guesses',()=>{
 assert.equal(matches([], 'vision'),false);assert.equal(matches(['vision'],'vision'),true);
 assert.equal(matches(['thinking'],'reasoning'),true);assert.equal(matches(['tool_use'],'tools'),true);
 assert.equal(matches(['embeddings'],'all'),false);assert.equal(matches(['vision'],'all'),true);
});
test('a model deleted from the local catalogue reads as No model selected',()=>{
 const installed=[{name:'Kept',loaded:false},{name:'Hot',loaded:true}];
 assert.equal(label({model:'Gone'},installed),'No model selected');
 assert.equal(label({model:'Kept'},installed),'Kept');
 assert.equal(label({routing:'auto',model:'Gone'},installed),'Auto (Fast/Smart)');
 assert.equal(label({},installed),'Hot');
});
test('a free chat (no project, no per-chat choice) starts on Auto, not whatever is loaded (#305)',()=>{
 // autoRolesConfigured defaults true, matching the server treating Fast/Smart-configured as Auto.
 assert.equal(label(null,[{name:'Hot',loaded:true}]),'Auto (Fast/Smart)');
 assert.equal(label(undefined,[{name:'Hot',loaded:true}]),'Auto (Fast/Smart)');
 assert.equal(label(null,[]),'Auto (Fast/Smart)');
 assert.equal(label(null,null),'Auto (Fast/Smart)');
 // A project stays whatever it is explicitly set to (manual, no model chosen yet): unaffected.
 assert.equal(label({},[{name:'Hot',loaded:true}]),'Hot');
});
test('a free chat only says Auto when the server would really route it that way (model review, #305)',()=>{
 // Without Fast/Smart roles configured, chat.cjs falls back to the loaded model server-side —
 // the label must match, not promise a routing decision that will not happen.
 assert.equal(label(null,[{name:'Hot',loaded:true}],false),'Hot');
 assert.equal(label(null,[],false),'local model');
 assert.equal(label(undefined,null,false),'local model');
 assert.equal(label(null,[{name:'Hot',loaded:true}],true),'Auto (Fast/Smart)');
 // An explicit choice (a project, or a free chat's own context project) is unaffected either way.
 assert.equal(label({routing:'auto',model:'Gone'},[{name:'Hot',loaded:true}],false),'Auto (Fast/Smart)');
 assert.equal(label({model:'Kept'},[{name:'Kept'}],false),'Kept');
});
test('#848: a manual choice on a non-local provider with no model never borrows the loaded local model',()=>{
 const installed=[{name:'Hot',loaded:true}];
 // The server falls back to the loaded model for the local provider only (chat.cjs), so another
 // provider with no model picked is "No model selected" — whatever is loaded locally.
 assert.equal(label({routing:'manual',provider:'chatgpt-oauth'},installed),'No model selected');
 assert.equal(label({provider:'cloud-a',model:''},installed),'No model selected');
 assert.equal(label({provider:'cloud-a'},null),'No model selected');
 assert.equal(label({provider:'cloud-a'},installed,false),'No model selected');
 // Local spellings keep the fallback: unset, the legacy alias, and the default's id.
 assert.equal(label({routing:'manual'},installed),'Hot');
 assert.equal(label({provider:'default'},installed),'Hot');
 assert.equal(label({provider:'lemonade'},installed),'Hot');
 assert.equal(label({provider:'custom-default'},installed,true,'custom-default'),'Hot');
 assert.equal(label({provider:'default'},installed,true,'custom-default'),'No model selected');
 // A picked model is untouched. Auto is only promised on the local provider: chat.cjs treats an
 // `auto` choice on another provider as manual (#876), so it reads as manual here too.
 assert.equal(label({provider:'cloud-a',model:'remote-1'},installed),'remote-1');
 assert.equal(label({provider:'cloud-a',routing:'auto'},installed),'No model selected');
});
test('an unknown catalogue or another provider never declares a model missing',()=>{
 assert.equal(label({model:'Gone'},null),'Gone');
 assert.equal(label({model:'remote-model-a',provider:'remote-provider'},[]),'remote-model-a');
});
test('warns when a unified-memory GPU may borrow nearly all host RAM',()=>{
 const {sharedMemoryRisk:risk}=exports_;
 // DaServer 2026-09-17: 29 GiB host, GTT allowed ~27 GiB.
 const r=risk({unified:true,sharedTotalGB:27,hostTotalGB:29});
 assert.equal(r.risky,true);assert.equal(r.leftGB,2);assert.match(r.message,/29 GiB/);assert.match(r.message,/27 GiB/);
 assert.equal(risk({unified:true,sharedTotalGB:16,hostTotalGB:64}).risky,false);
 assert.equal(risk({unified:false,sharedTotalGB:27,hostTotalGB:29}).risky,false);
 for(const host of [0,null,NaN])assert.equal(risk({unified:true,sharedTotalGB:27,hostTotalGB:host}).risky,false);
});
test('#876: with a custom default provider id the label follows the server, not the literal "default"',()=>{
 const installed=[{name:'Hot',loaded:true}];
 // The server's local provider is `homelab`: a chat on it with no model sends on the loaded model.
 assert.equal(label({provider:'homelab'},installed,true,'homelab'),'Hot');
 assert.equal(label({provider:'homelab',routing:'manual'},null,true,'homelab'),'local model');
 // ...and the literal 'default' is then just another provider, with nothing to borrow.
 assert.equal(label({provider:'default'},installed,true,'homelab'),'No model selected');
 // Without the real id the old assumption made the first case read "No model selected".
 assert.equal(label({provider:'homelab'},installed),'No model selected');
 // An `auto` choice on a non-local provider is manual server-side (chat.cjs): no Auto promise.
 assert.equal(label({routing:'auto',provider:'cloud-a'},installed,true,'homelab'),'No model selected');
 assert.equal(label({routing:'auto',provider:'cloud-a',model:'gpt-x'},installed,true,'homelab'),'gpt-x');
 assert.equal(label({routing:'auto',provider:'homelab'},installed,true,'homelab'),'Auto (Fast/Smart)');
 assert.equal(label({routing:'auto',provider:'lemonade'},installed,true,'homelab'),'Auto (Fast/Smart)');
});
