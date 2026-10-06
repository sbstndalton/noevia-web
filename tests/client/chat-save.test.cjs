const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const load=(f)=>{const m={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',f),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:m});return m;};
const s=load('chat-save.ts'),tm=load('transcript-merge.ts');
const J=(v)=>JSON.parse(JSON.stringify(v));

test('overlapping new-chat sends in one list both survive, written in order from the latest list',async()=>{
 // Synthetic server: a whole-list PUT whose responses can complete out of order.
 let server=[{id:'old',title:'Old',updatedAt:1}];const puts=[];const latest={list:server};
 const put=(list,delay)=>new Promise(r=>setTimeout(()=>{server=list;puts.push(list.map(c=>c.id));r();},delay));
 const queue=new Map();
 const send=(id,delay)=>s.enqueueKeyed(queue,'free',async()=>{
  const next=s.upsertChatMeta(latest.list,id,(e)=>e?{...e,updatedAt:9}:{id,title:id,updatedAt:5});
  await put(next,delay);latest.list=next;});
 // Both sends start before either write lands; the first write is the slower one.
 await Promise.all([send('a',20),send('b',1)]);
 assert.deepEqual([...server.map(c=>c.id).sort()],['a','b','old']);
 assert.deepEqual(J(puts),[['a','old'],['b','a','old']]);
 assert.equal(queue.size,0);
});

test('a failed list write does not block the next one',async()=>{
 const queue=new Map(),ran=[];
 const first=s.enqueueKeyed(queue,'project:p',async()=>{ran.push(1);throw new Error('offline');});
 const second=s.enqueueKeyed(queue,'project:p',async()=>{ran.push(2);});
 await assert.rejects(first);await second;assert.deepEqual(ran,[1,2]);
});

test('upsert moves an existing chat to the top and keeps every other chat',()=>{
 const out=s.upsertChatMeta([{id:'x',title:'X',updatedAt:1},{id:'y',title:'Y',updatedAt:2}],'y',(e)=>({...e,updatedAt:3}));
 assert.deepEqual(J(out.map(c=>[c.id,c.updatedAt])),[['y',3],['x',1]]);
});

test('a conflict merge keeps ids so a streaming reply still finds its placeholder',()=>{
 let n=0;const mint=()=>`new-${++n}`;const fromEntry=(h,id)=>({id,role:h.role,content:h.content});
 // Local state while a second reply streams: q1/a1 saved earlier, q2 + placeholder live.
 const current=[{id:'u1',role:'user',content:'q1'},{id:'r1',role:'assistant',content:'a1'},{id:'u2',role:'user',content:'q2'},{id:'r2',role:'assistant',content:'partial',reasoning:'…'}];
 // The earlier save of [q1,a1] conflicted with another device that added a turn.
 const theirs=[{role:'user',content:'q1'},{role:'assistant',content:'a1'},{role:'user',content:'other device'}];
 const merged=tm.mergeTranscripts(theirs,[{role:'user',content:'q1'},{role:'assistant',content:'a1'}]);
 const shown=s.adoptMergedTranscript(current,merged,mint,fromEntry);
 assert.deepEqual(J(shown.map(m=>m.id)),['u1','r1','new-1']);
 // App defers that merge while the chat is sending; at stream end it re-merges with the full
 // local transcript, keeping the live ids so no update keyed on replyId is lost.
 const final=current.map(m=>({role:m.role,content:m.content}));
 const remerged=tm.mergeTranscripts(merged,final);
 const after=s.adoptMergedTranscript(current,remerged,mint,fromEntry);
 assert.deepEqual(J(after.map(m=>m.content)),['q1','a1','other device','q2','partial']);
 assert.deepEqual(J(after.map(m=>m.id)),['u1','r1','new-2','u2','r2']);
 assert.equal(after[4].reasoning,'…');
});

test('duplicate turns map to distinct local messages in order',()=>{
 const cur=[{id:'a',role:'user',content:'hi'},{id:'b',role:'user',content:'hi'}];
 const out=s.adoptMergedTranscript(cur,[{role:'user',content:'hi'},{role:'user',content:'hi'}],()=>'x',(h,id)=>({id,...h}));
 assert.deepEqual(J(out.map(m=>m.id)),['a','b']);
});

test('a chat deleted in this session is never saved again',()=>{
 const deleted=new Set(['gone']);
 assert.equal(s.shouldSaveChat('gone',deleted),false);
 assert.equal(s.shouldSaveChat('kept',deleted),true);
 assert.equal(s.shouldSaveChat('',deleted),false);
});
