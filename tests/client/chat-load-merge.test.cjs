const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const load=(f)=>{const m={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',f),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:m,Math});return m;};
const s=load('chat-save.ts'),sys=load('model-system.ts');
const M=(id,role,content,extra={})=>({id,role,content,...extra});

test('loaded history is shown as is when nothing is on screen yet',()=>{
 const loaded=[M('a','user','synthetic q1'),M('b','assistant','synthetic a1')];
 assert.equal(s.resolveLoadedHistory([],loaded),loaded);
});

test('a send made before the load resolved keeps its turn and live placeholder id',()=>{
 const loaded=[M('a','user','synthetic q1'),M('b','assistant','synthetic a1')];
 const live=[M('u','user','synthetic q2'),M('r','assistant','')];
 const out=s.resolveLoadedHistory(live,loaded);
 assert.deepEqual([...out.map(m=>m.id)],['a','b','u','r']);
 assert.equal(out[3],live[1]);
});

test('local copy that already extends the loaded one is kept unchanged',()=>{
 const loaded=[M('a','user','synthetic q1')];
 const live=[M('x','user','synthetic q1'),M('r','assistant','partial')];
 assert.equal(s.resolveLoadedHistory(live,loaded),live);
});

test('only the latest stats request may apply',()=>{
 const g=s.latestGate();const poll=g.next();const usage=g.next();
 assert.equal(g.isLatest(poll),false);assert.equal(g.isLatest(usage),true);
});

test('configure tab hides rename and remove for the system routing model',()=>{
 assert.equal(sys.isSystemModel('laya_multilingual_f16'),true);
 const src=fs.readFileSync(path.join(__dirname,'../../src/components/models/ConfigureTab.tsx'),'utf8');
 assert.match(src,/data\.exists && !isSystemModel\(name\) && <details className="mm-disclosure"><summary>\{t\('mm.editor.renameOrDelete'\)\}/);
 assert.match(src,/const doDelete = async \(\) => \{\n\s*if \(!data \|\| isSystemModel\(name\)\) return;/);
 assert.match(src,/const doRename = async \(\) => \{\n\s*if \(!data \|\| isSystemModel\(name\)\) return;/);
});
