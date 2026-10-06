const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/archived-chats.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ex={};vm.runInNewContext(code,{exports:ex});
const w={freeChats:[{id:'a',title:'Battery notes',updatedAt:3,archived:true},{id:'b',title:'Live chat',updatedAt:9}],projects:[{id:'p1',name:'Garden Café',chats:[{id:'a',title:'Tomato plan',updatedAt:5,archived:true},{id:'c',title:'',updatedAt:1,archived:true}]}]};
test('collects archived chats only, from free chats and projects, newest first',()=>{
 const rows=ex.collectArchived(w);
 assert.equal(rows.map(ex.rowKey).join(),'p1/a,/a,p1/c');
 assert.equal(rows.some(r=>r.chat.id==='b'),false);
});
test('search matches title or project, every word, ignoring case and accents',()=>{
 const rows=ex.collectArchived(w);
 assert.equal(ex.filterArchived(rows,'').length,3);
 assert.equal(ex.filterArchived(rows,'BATTERY').map(r=>r.chat.id).join(),'a');
 assert.equal(ex.filterArchived(rows,'cafe').length,2,'project name, accent-insensitive');
 assert.equal(ex.filterArchived(rows,'cafe tomato').map(ex.rowKey).join(),'p1/a');
 assert.equal(ex.filterArchived(rows,'untitled').map(ex.rowKey).join(),'p1/c');
 assert.equal(ex.filterArchived(rows,'zzz').length,0);
});
