// #768: the project card's chat count leaves out archived chats and counts them separately.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/project-chat-count.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ex={};vm.runInNewContext(code,{exports:ex});
const plain=(o)=>({...o});
test('archived chats are not counted as chats',()=>{
 assert.deepEqual(plain(ex.countProjectChats([{archived:true}])),{active:0,archived:1});
 assert.deepEqual(plain(ex.countProjectChats([{},{archived:false},{archived:true}])),{active:2,archived:1});
});
test('empty or missing chat lists count zero',()=>{
 assert.deepEqual(plain(ex.countProjectChats([])),{active:0,archived:0});
 assert.deepEqual(plain(ex.countProjectChats(undefined)),{active:0,archived:0});
});
test('the project card uses the split count and the archived plural key exists in every catalogue',()=>{
 const view=fs.readFileSync(path.join(__dirname,'../../src/components/ProjectsView.tsx'),'utf8');
 assert.match(view,/countProjectChats\(p\.chats\)/);
 assert.doesNotMatch(view,/projects\.count\.chats', p\.chats\.length/);
 for(const loc of ['en-GB','de-DE','es-ES','fr-FR','it-IT','nb-NO','nl-NL','pt-BR','sv-SE']){
  const cat=fs.readFileSync(path.join(__dirname,`../../src/i18n/${loc}.ts`),'utf8');
  for(const k of ['projects.count.archivedChats.one','projects.count.archivedChats.other','storage.savedUnchecked'])assert.ok(cat.includes(`'${k}'`),`${loc} has ${k}`);
  assert.match(cat,/'storage\.savedUnchecked': "[^"]*\{status\}/,`${loc} savedUnchecked keeps {status}`);
 }
});
test('#775: the project header and the sidebar hover card use the split count; delete-confirm keeps the total',()=>{
 const view=fs.readFileSync(path.join(__dirname,'../../src/components/ProjectView.tsx'),'utf8');
 assert.match(view,/countProjectChats\(project\.chats\)/);
 assert.doesNotMatch(view,/projects\.count\.chats', project\.chats\.length/);
 const side=fs.readFileSync(path.join(__dirname,'../../src/components/Sidebar.tsx'),'utf8');
 assert.match(side,/sidebar\.count\.chats', countProjectChats\(p\.chats\)\.active\)/);
 // Deleting a project deletes its archived chats too, so the confirm names the full total.
 assert.match(side,/confirmDeleteProjectBody', \{ chats: t\.plural\('sidebar\.count\.chats', \(p\.chats \|\| \[\]\)\.length\)/);
});
