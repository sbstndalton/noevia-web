const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/user-preferences.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ex={};vm.runInNewContext(code,{exports:ex,require:(m)=>m==='react'?{useEffect(){},useState(v){return [v,()=>{}];}}:{apiFetch(){}}});
const k=(o={})=>({key:'Enter',shiftKey:false,metaKey:false,ctrlKey:false,...o});

test('Enter-to-send: Enter sends, Shift+Enter is a new line, IME never sends',()=>{
 assert.equal(ex.composerKeyAction(k(),'enter'),'send');
 assert.equal(ex.composerKeyAction(k({shiftKey:true}),'enter'),null);
 assert.equal(ex.composerKeyAction(k({isComposing:true}),'enter'),null);
 assert.equal(ex.composerKeyAction(k({key:'a'}),'enter'),null);
});
test('Mod+Enter-to-send: plain Enter is a new line, ⌘/Ctrl+Enter sends',()=>{
 assert.equal(ex.composerKeyAction(k(),'mod-enter'),null);
 assert.equal(ex.composerKeyAction(k({metaKey:true}),'mod-enter'),'send');
 assert.equal(ex.composerKeyAction(k({ctrlKey:true}),'mod-enter'),'send');
 assert.equal(ex.composerKeyAction(k({ctrlKey:true,shiftKey:true}),'mod-enter'),null);
 assert.equal(ex.composerKeyAction(k({metaKey:true,isComposing:true}),'mod-enter'),null);
});
test('hints name the platform key',()=>{
 assert.equal(ex.sendHint('enter',true),'Enter to send · ⇧Enter for a new line');
 assert.equal(ex.sendHint('mod-enter',false),'Ctrl+Enter to send · Enter for a new line');
 assert.equal(ex.sendHint('mod-enter',true),'⌘Enter to send · Enter for a new line');
});
test('preference precedence: saved record over defaults, unknown values fall back, events default on',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(ex.normalisePreferences(null))),{notifications:{replyFinished:true,approvalNeeded:true},sendKey:'enter',locale:'system'});
 const p=ex.normalisePreferences({notifications:{replyFinished:false},sendKey:'mod-enter',locale:'nb-NO'});
 assert.equal(p.notifications.replyFinished,false);assert.equal(p.notifications.approvalNeeded,true);assert.equal(p.sendKey,'mod-enter');assert.equal(p.locale,'nb-NO');
 const bad=ex.normalisePreferences({notifications:{replyFinished:'no'},sendKey:'space',locale:'xx'});
 assert.equal(bad.notifications.replyFinished,true);assert.equal(bad.sendKey,'enter');assert.equal(bad.locale,'system');
 assert.equal(ex.resolveLocale('system'),undefined);assert.equal(ex.resolveLocale('de-DE'),'de-DE');
});
test('notification events are named by event, never finance',()=>{
 assert.equal(ex.NOTIFICATION_EVENTS.map(e=>e.id).join(),'replyFinished,approvalNeeded');
 assert.ok(!ex.NOTIFICATION_EVENTS.some(e=>/bill|credit|pay|subscri/i.test(e.label)));
});
