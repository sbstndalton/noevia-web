const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
// The hook file imports react and ./api; only the plain loader is exercised, with both stubbed.
const code=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../../src/use-default-provider-id.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports_={};
vm.runInNewContext(code,{exports:exports_,require:(m)=>m==='react'?{useEffect(){},useState:(v)=>[v,()=>{}]}:{fetchProviders:()=>Promise.reject(new Error('unused'))},Promise});
test('the loader reads the default provider id from the registry once and keeps it',async()=>{
 let calls=0;
 const load=async()=>{calls++;return {providers:[{id:'cloud-a'},{id:'homelab',isDefault:true}]};};
 assert.equal(await exports_.loadDefaultProviderId(load),'homelab');
 assert.equal(await exports_.loadDefaultProviderId(load),'homelab');
 assert.equal(calls,1);
});
