const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/memory-edit.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ex={};vm.runInNewContext(code,{exports:ex});
const src=fs.readFileSync(path.join(__dirname,'../../src/components/personalization/MemorySettings.tsx'),'utf8');
test('Enter commits a memory line only outside IME composition',()=>{
 assert.equal(ex.isCommitKey('Enter',false),true);
 assert.equal(ex.isCommitKey('Enter',true),false);
 assert.equal(ex.isCommitKey('a',false),false);
 // Both memory inputs route Enter through the guard.
 assert.equal((src.match(/isCommitKey\(e\.key, e\.nativeEvent\.isComposing\)/g)||[]).length,2);
 assert.doesNotMatch(src,/e\.key === 'Enter'/);
});
test('an emptied edit asks before forgetting; a real edit is normalised',()=>{
 assert.deepEqual({...ex.editOutcome('   \n ')},{kind:'confirm-forget'});
 assert.deepEqual({...ex.editOutcome('  I keep   bees ')},{kind:'save',text:'I keep bees'});
});
test('Forget on a single line and an emptied edit both go through the confirm dialog',()=>{
 assert.match(src,/aria-label=\{t\('memory\.forgetLine', \{ line: m \}\)\} onClick=\{\(\) => askForget\(i, m\)\}/);
 assert.match(src,/aria-label=\{t\('memory\.forgetLineIn', \{ line: m, project: p\.name \}\)\} onClick=\{\(\) => setConfirm\(/);
 assert.match(src,/outcome\.kind === 'confirm-forget'\) \{ askForget\(/);
});
