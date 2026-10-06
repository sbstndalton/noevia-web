const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/components/shortcuts/shortcuts.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ex={};vm.runInNewContext(code,{exports:ex});
const k=(key,o={})=>({key,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,...o});
test('⌘ on Apple and Ctrl elsewhere; the other modifier never triggers',()=>{
 assert.equal(ex.matchShortcut(k('k',{metaKey:true}),true),'search');
 assert.equal(ex.matchShortcut(k('k',{ctrlKey:true}),true),null);
 assert.equal(ex.matchShortcut(k('K',{ctrlKey:true}),false),'search');
 assert.equal(ex.matchShortcut(k('k',{metaKey:true}),false),null);
});
test('shift must match exactly, alt and IME composition never trigger, plain keys never trigger',()=>{
 assert.equal(ex.matchShortcut(k('O',{metaKey:true,shiftKey:true}),true),'newChat');
 assert.equal(ex.matchShortcut(k('o',{metaKey:true}),true),null);
 assert.equal(ex.matchShortcut(k('k',{metaKey:true,altKey:true}),true),null);
 assert.equal(ex.matchShortcut(k('k',{metaKey:true,isComposing:true}),true),null);
 assert.equal(ex.matchShortcut(k('k'),true),null);
 assert.equal(ex.matchShortcut(k(',',{ctrlKey:true}),false),'settings');
 assert.equal(ex.matchShortcut(k('/',{metaKey:true}),true),'help');
});
test('labels follow the platform',()=>{
 const newChat=ex.SHORTCUTS.find(s=>s.id==='newChat');
 assert.equal(ex.describe(newChat,true),'⌘⇧O');assert.equal(ex.describe(newChat,false),'Ctrl+Shift+O');
 assert.equal(ex.isApple('MacIntel'),true);assert.equal(ex.isApple('Win32'),false);
});
test('"?" opens help only outside text fields and never with a modifier',()=>{
 assert.equal(ex.isHelpKey({...k('?',{shiftKey:true}),targetEditable:false}),true);
 assert.equal(ex.isHelpKey({...k('?',{shiftKey:true}),targetEditable:true}),false);
 assert.equal(ex.isHelpKey({...k('?',{metaKey:true}),targetEditable:false}),false);
});
test('reference table: every handled shortcut is listed, send keys follow the preference, search filters',()=>{
 const rows=ex.referenceShortcuts(true,'enter');
 for(const s of ex.SHORTCUTS)assert.ok(rows.some(r=>r.label===s.label&&r.keys===ex.describe(s,true)),s.id);
 assert.equal(rows.find(r=>r.label==='Send a message').keys,'Enter');
 assert.equal(ex.referenceShortcuts(false,'mod-enter').find(r=>r.label==='Send a message').keys,'Ctrl+Enter');
 assert.equal(ex.referenceShortcuts(false,'mod-enter').find(r=>r.label==='New line in a message').keys,'Enter');
 assert.equal(ex.filterShortcuts(rows,'').length,rows.length);
 assert.deepEqual(ex.filterShortcuts(rows,'SETTINGS').map(r=>r.label).includes('Open Settings'),true);
 assert.equal(ex.filterShortcuts(rows,'esc').every(r=>/esc/i.test(r.keys+r.label)),true);
 assert.equal(ex.filterShortcuts(rows,'zzzz').length,0);
});
