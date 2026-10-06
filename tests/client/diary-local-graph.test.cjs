'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const load=(file,req)=>{const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require:req});return mod.exports;};
const markdown=load('diary-markdown.ts',()=>{throw Error('no deps')});
const {localGraph,GRAPH_LIMIT}=load('diary-local-graph.ts',(id)=>{if(id==='./diary-markdown')return markdown;throw Error(id);});

test('links out (Markdown and wiki), links in and two-way links, without the file itself',()=>{
 const text='See [plan](plan.md), [[Ideas]], [[Ideas#Later|again]], ![[figure.png]], `[[not a link]]` and [self](today.md).';
 const g=localGraph({path:'Diary/2026/today.md',text,root:'Diary',backlinks:['Diary/2026/plan.md','Diary/people/anna.md','Diary/2026/today.md']});
 const by=Object.fromEntries(g.nodes.map(n=>[n.id,n.relation]));
 assert.deepEqual(by,{'Diary/2026/today.md':'self','Diary/2026/plan.md':'both','Diary/Ideas.md':'out','Diary/people/anna.md':'in'});
 assert.deepEqual(JSON.parse(JSON.stringify(g.nodes.map(n=>n.id))),['Diary/2026/today.md','Diary/2026/plan.md','Diary/Ideas.md','Diary/people/anna.md'],'two-way first, then out, then in');
 assert.equal(g.nodes[0].x,0);assert.equal(g.nodes[1].label,'plan');assert.equal(g.hidden,0);
});

test('capped, with the rest counted, and every node inside the drawing',()=>{
 const backlinks=Array.from({length:40},(_,i)=>`Diary/n${String(i).padStart(2,'0')}.md`);
 const g=localGraph({path:'Diary/x.md',text:'',root:'Diary',backlinks});
 assert.equal(g.nodes.length,GRAPH_LIMIT+1);assert.equal(g.hidden,40-GRAPH_LIMIT);
 for(const n of g.nodes){assert.ok(Math.abs(n.x)<=1&&Math.abs(n.y)<=1,n.id);}
 assert.equal(new Set(g.nodes.map(n=>`${n.x},${n.y}`)).size,g.nodes.length,'no two nodes on the same spot');
});

test('a lonely file is just itself',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(localGraph({path:'Diary/a.md',text:'no links',root:'Diary',backlinks:[]}))),{nodes:[{id:'Diary/a.md',label:'a',relation:'self',x:0,y:0}],edges:[],hidden:0});
});
