'use strict';
const GOLDEN=[["Diary/2026/today.md","today","self",0,0],["Diary/2026/plan.md","plan","both",0,-0.62],["Diary/Ideas.md","Ideas","out",0.31,-0.537],["Diary/Later.md","Later","out",0.537,-0.31],["Diary/n00.md","n00","in",0.62,0],["Diary/n01.md","n01","in",0.537,0.31],["Diary/n02.md","n02","in",0.31,0.537],["Diary/n03.md","n03","in",0,0.62],["Diary/n04.md","n04","in",-0.31,0.537],["Diary/n05.md","n05","in",-0.537,0.31],["Diary/n06.md","n06","in",-0.62,0],["Diary/n07.md","n07","in",-0.537,-0.31],["Diary/n08.md","n08","in",-0.31,-0.537],["Diary/n09.md","n09","in",0.797,-0.46],["Diary/n10.md","n10","in",0,0.92],["Diary/n11.md","n11","in",-0.797,-0.46]];
// #741: chat organisation — tag tree, #tag search, backlinks, [[chat]] links, the chat graph — and
// the generalised graph layout the Diary's local graph now runs on (unchanged output).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const load=(file,req)=>{const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require:req});return mod.exports;};
const markdown=load('diary-markdown.ts',()=>{throw Error('no deps')});
const graph=load('diary-local-graph.ts',(id)=>{if(id==='./diary-markdown')return markdown;throw Error(id);});
const org=load('chat-organise.ts',(id)=>{if(id==='./diary-local-graph')return graph;throw Error(id);});
const search=load('sidebar-search.ts',()=>{throw Error('no deps')});
const plain=(v)=>JSON.parse(JSON.stringify(v));
const frame=(tags=[],links=[],extra={})=>({projectId:null,kind:'search',tags,links,confirmed:true,source:'user',...extra});
const chat=(id,title,f,extra={})=>({id,title,updatedAt:extra.updatedAt??1,...(f?{frame:f}:{}),...extra});

test('tag tree: nested tags group like folders, counts are distinct chats, archived chats are left out',()=>{
  const chats=[
    chat('a','A',frame(['work/clients','travel'])),
    chat('b','B',frame(['work','Work/Clients/acme'])),
    chat('c','C',frame(['travel'])),
    chat('d','D',frame(['secret']),{archived:true}),
    chat('e','E',null),
    chat('f','F',frame(['//','a//b/'])),
  ];
  const tree=plain(org.tagTree(chats));
  const flat=(nodes)=>nodes.map(n=>[n.path,n.count,flat(n.children)]);
  assert.deepEqual(flat(tree),[
    ['a',1,[['a/b',1,[]]]],
    ['travel',2,[]],
    ['work',2,[['work/clients',2,[['work/clients/acme',1,[]]]]]],
  ]);
  assert.equal(tree.find(n=>n.path==='work').children[0].name,'clients','the first spelling seen is shown');
  assert.deepEqual(plain(org.tagTree([])),[]);
});

test('hasTag: exact or nested, case-insensitive, never a prefix of a different word',()=>{
  const c=chat('a','A',frame(['work/clients/acme']));
  assert.equal(org.hasTag(c,'work'),true);
  assert.equal(org.hasTag(c,'Work/Clients'),true);
  assert.equal(org.hasTag(c,'work/clients/acme'),true);
  assert.equal(org.hasTag(c,'wor'),false);
  assert.equal(org.hasTag(c,'work/client'),false);
  assert.equal(org.hasTag(c,''),false);
  assert.equal(org.hasTag(chat('b','B',null),'work'),false);
});

test('#tag search: tags filter by frame, the rest by title; a plain query behaves as before',()=>{
  assert.deepEqual(plain(search.parseSidebarQuery('#work/clients  plan #x')),{tags:['work/clients','x'],text:'plan'});
  assert.deepEqual(plain(search.parseSidebarQuery('# lone')),{tags:[],text:'lone'});
  const a=chat('a','Plan the trip',frame(['travel/eu'])),b=chat('b','Plan work',frame(['work'])),c=chat('c',' spaced title',null);
  const m=(q)=>[a,b,c].filter(x=>search.chatMatchesQuery(x,q,org.hasTag)).map(x=>x.id);
  assert.deepEqual(m('#travel'),['a']);
  assert.deepEqual(m('#travel plan'),['a']);
  assert.deepEqual(m('#travel work'),[]);
  assert.deepEqual(m('#work #travel'),[]);
  assert.deepEqual(m('plan'),['a','b']);
  assert.deepEqual(m(' spaced'),['c'],'without a tag the whole query, spaces included, is matched as before');
});

test('backlinks: only chats in the given lists that link here, newest first, never itself or archived',()=>{
  const chats=[chat('t','Target',frame([],['t'])),chat('x','X',frame([],['t']),{updatedAt:5}),chat('y','Y',frame([],['t','z']),{updatedAt:9}),chat('z','Z',frame([],['q'])),chat('old','Old',frame([],['t']),{archived:true})];
  assert.deepEqual(plain(org.backlinks('t',chats).map(c=>c.id)),['y','x']);
  assert.deepEqual(plain(org.backlinks('nobody',chats).map(c=>c.id)),[]);
  assert.deepEqual(plain(org.outgoingLinks(chats[2],chats).map(c=>c.id)),['t','z']);
  assert.deepEqual(plain(org.outgoingLinks(chat('g','G',frame([],['gone'])),chats).map(c=>c.id)),[],'a deleted target drops out');
});

test('[[ candidates: title matches, prefix first then newest, never the chat itself, at most eight',()=>{
  const chats=[chat('self','Trip self',null,{updatedAt:99}),chat('a','Old trip',null,{updatedAt:1}),chat('b','Trip budget',null,{updatedAt:2}),chat('c','New trip',null,{updatedAt:3}),chat('d','',null),chat('e','trip archived',null,{archived:true})];
  assert.deepEqual(plain(org.chatLinkCandidates('trip',chats,'self').map(c=>c.id)),['b','c','a']);
  assert.equal(org.chatLinkCandidates('',Array.from({length:20},(_,i)=>chat(`n${i}`,`Chat ${i}`,null)),'x').length,8);
});

test('[[ insert: the typed query becomes the link, brackets in a title cannot end it early',()=>{
  const text='See [[tri and more';
  const start=markdown.wikiLinkQueryAt(text,9).start;
  assert.deepEqual(plain(org.insertChatLink(text,start,9,'Trip [draft]')),{text:'See [[Trip (draft)]] and more',caret:20});
});

test('frameWithLink: adds to an existing frame, makes an unconfirmed link-only frame otherwise',()=>{
  const framed=chat('a','A',frame(['t'],['x']));
  assert.deepEqual(plain(org.frameWithLink(framed,'a','y',null)),frame(['t'],['x','y']));
  assert.equal(org.frameWithLink(framed,'a','x',null),null,'already linked');
  assert.equal(org.frameWithLink(framed,'a','a',null),null,'no self link');
  assert.equal(org.frameWithLink(chat('f','F',frame([],Array.from({length:20},(_,i)=>`l${i}`))),'f','new',null),null,'full');
  const fresh=plain(org.frameWithLink(chat('b','B',null),'b','x','p1'));
  assert.deepEqual(fresh,{projectId:'p1',kind:'question',tags:[],links:['x'],confirmed:false,source:'user'});
  assert.deepEqual(plain(org.frameWithLink(undefined,'b','x',null)).links,['x'],'a chat not saved yet');
});

test('keepLinks: accepting a suggestion keeps links already stored',()=>{
  const next=frame(['t'],['s1']);
  assert.deepEqual(plain(org.keepLinks(next,frame([],['typed','s1']))).links,['s1','typed']);
  assert.equal(org.keepLinks(next,null),next);
});

test('chat graph: links out, in and both, plus one hub per tag; tag hubs never collide with chat ids',()=>{
  const me=chat('me','Me',frame(['work/a','work/a'],['o','b','gone']));
  const chats=[me,chat('o','Out',null),chat('b','Both',frame([],['me'])),chat('i','In',frame([],['me'])),chat('n','None',null)];
  const g=plain(org.chatGraph(me,chats,'New chat'));
  assert.deepEqual(g.nodes.map(n=>[n.id,n.label,n.relation]),[['me','Me','self'],['b','Both','both'],['o','Out','out'],['i','In','in'],['tag:work/a','#work/a','tag']]);
  assert.deepEqual(g.edges.map(e=>[e.from,e.to,e.relation]),[['me','b','both'],['me','o','out'],['me','i','in'],['me','tag:work/a','tag']]);
  assert.equal(g.hidden,0);
  assert.deepEqual(plain(org.chatGraph(chat('lone','',null),[],'New chat')).nodes,[{id:'lone',label:'New chat',relation:'self',x:0,y:0}]);
});

test('radialGraph: generic nodes and edges, de-duplicated, capped and counted',()=>{
  const n=Array.from({length:30},(_,i)=>({id:`n${String(i).padStart(2,'0')}`,label:`N${i}`,relation:'in'}));
  const g=graph.radialGraph({id:'c',label:'C'},[...n,{id:'c',label:'self again',relation:'out'},{id:'n00',label:'dup',relation:'out'}]);
  assert.equal(g.nodes.length,graph.GRAPH_LIMIT+1);
  assert.equal(g.edges.length,graph.GRAPH_LIMIT);
  assert.equal(g.hidden,30-graph.GRAPH_LIMIT);
  assert.ok(g.edges.every(e=>e.from==='c'));
});

test('the Diary local graph draws exactly what it drew before the generalisation (golden from origin/main)',()=>{
  const g=graph.localGraph({path:'Diary/2026/today.md',text:'See [plan](plan.md), [[Ideas]] and [[Later]].',root:'Diary',backlinks:['Diary/2026/plan.md',...Array.from({length:12},(_,i)=>'Diary/n'+String(i).padStart(2,'0')+'.md')]});
  assert.deepEqual(plain(g.nodes.map(n=>[n.id,n.label,n.relation,n.x,n.y])),GOLDEN);
  assert.equal(g.hidden,0);
  assert.deepEqual(plain(g.edges.map(e=>e.to)),GOLDEN.slice(1).map(n=>n[0]),'one edge from the file to each neighbour, as the drawing had');
});
