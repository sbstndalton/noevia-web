// #887: a directory title is untrusted registry metadata, so the label always carries the id too.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../../src/mcp-server-label.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports_={};
vm.runInNewContext(code,{exports:exports_,Map,Promise,Date,require:(m)=>m==='react'?{useEffect(){},useState:(v)=>[typeof v==='function'?v():v,()=>{}]}:{fetchToolboxes:()=>Promise.reject(new Error('unused'))}});
test('a title is shown with the noevia-assigned id; no title shows the id alone',()=>{
 const known=new Map([['dir-spoof','Nextcloud']]);
 assert.equal(exports_.labelFor('dir-spoof',known),'Nextcloud (dir-spoof)');
 assert.equal(exports_.labelFor('nextcloud',known),'nextcloud');
 assert.equal(exports_.labelFor('x',null),'x');
});
test('the loader keys titles by server id from /api/toolboxes',async()=>{
 const m=await exports_.loadServerTitles(async()=>({toolboxes:[],mcp:{servers:[{id:'dir-a',title:'A'},{id:'nextcloud'}]}}));
 assert.equal(m.get('dir-a'),'A');assert.equal(m.has('nextcloud'),false);
});
