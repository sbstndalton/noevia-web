const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readSidebarOrder,recentChats,orderedProjects,moveProject} = require('../../src/sidebar-order.ts');
const project=(id,updatedAt,extra={})=>({id,name:id,updatedAt,createdAt:updatedAt,chats:[],...extra});
test('chat activity determines recency independently of pinning and input order',()=>{
  const chats=[{id:'old',updatedAt:1,pinned:true},{id:'new',updatedAt:9},{id:'hidden',updatedAt:12,archived:true}];
  assert.deepEqual(recentChats(chats).map(c=>c.id),['new','old']);
  assert.equal(chats.length,3);
});
test('recent projects include their latest chat activity',()=>{
  const projects=[project('a',1,{chats:[{id:'c',updatedAt:10}]}),project('b',5),project('hidden',20,{archived:true})];
  assert.deepEqual(orderedProjects(projects,{sort:'recent',order:[]}).map(p=>p.id),['a','b']);
});
test('manual order survives later activity and appends newly created projects',()=>{
  const projects=[project('a',100),project('b',1),project('new',200)];
  assert.deepEqual(orderedProjects(projects,{sort:'manual',order:['b','a']}).map(p=>p.id),['b','a','new']);
  assert.deepEqual(moveProject(['b','a','new'],'a','b'),['a','b','new']);
  assert.deepEqual(moveProject(['b','a'],'a','missing'),['b','a']);
});
test('persisted preferences recover from invalid values and duplicate IDs',()=>{
  assert.deepEqual(readSidebarOrder('not json'),{sort:'recent',order:[]});
  assert.deepEqual(readSidebarOrder('null'),{sort:'recent',order:[]});
  assert.deepEqual(readSidebarOrder('{"sort":"manual","order":["a",1,"a","b"]}'),{sort:'manual',order:['a','b']});
});
