const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../../src/menu-focus.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports_={};vm.runInNewContext(code,{exports:exports_});
const {shouldRefocusTrigger}=exports_;

const body={tagName:'BODY'};
const el=(tagName,inDialog=false)=>({tagName,closest:(sel)=>(inDialog&&sel==='dialog')?{}:null});

test('no active element, or focus still on body, refocuses the trigger',()=>{
  assert.equal(shouldRefocusTrigger(null,body),true);
  assert.equal(shouldRefocusTrigger(body,body),true);
});
test('an ordinary menu action (delete, archive) moves focus nowhere, so the trigger gets it back',()=>{
  assert.equal(shouldRefocusTrigger(el('BUTTON'),body),true);
  assert.equal(shouldRefocusTrigger(el('DIV'),body),true);
});
test('rename opens an input synchronously: it keeps focus, the trigger does not steal it back',()=>{
  for(const tag of ['INPUT','TEXTAREA','SELECT'])assert.equal(shouldRefocusTrigger(el(tag),body),false,tag);
});
test('an action that opens a confirm dialog keeps focus inside it',()=>{
  assert.equal(shouldRefocusTrigger(el('BUTTON',true),body),false);
});
