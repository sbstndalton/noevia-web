const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const result={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/chat-title.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:result});
test('first-prompt edits update derived titles while later edits and custom names survive',()=>{
 const first={role:'user',content:'Original prompt'},reply={role:'assistant',content:'Answer'};
 assert.equal(result.titleAfterSend('Original prompt',[first,reply],[],'Corrected prompt'),'Corrected prompt');
 assert.equal(result.titleAfterSend('My custom name',[first,reply],[],'Corrected prompt'),'My custom name');
 assert.equal(result.titleAfterSend('Original prompt',[first,reply],[first,reply],'Later edit'),'Original prompt');
 assert.equal(result.titleAfterSend('Original prompt',[first],undefined,'Follow-up'),'Original prompt');
 assert.equal(result.titleAfterSend('x'.repeat(80),[{role:'user',content:'x'.repeat(120)}],[],'y'.repeat(120)),'y'.repeat(80));
});
