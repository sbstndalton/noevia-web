const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const exportsObject={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/source-refresh.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject,Date});
const {sourceRefresher}=exportsObject;
test('unavailable surfaces wait, repeated return events coalesce, stale periods refresh',async()=>{
 let now=0,available=false,calls=0,resolve;const attempts={},pending=new Set(),results=[];
 const watcher=sourceRefresher({key:'project:folder',attempts,pending,available:()=>available,now:()=>now,refresh:()=>{calls++;return new Promise(r=>resolve=r);},updated:r=>results.push(r),failed:()=>assert.fail('unexpected failure')});
 await watcher.run();assert.equal(calls,0);
 available=true;const first=watcher.run();await watcher.run();assert.equal(calls,1);
 now=400000;await watcher.run();assert.equal(calls,1,'a long in-flight job still deduplicates');resolve('changed file');await first;assert.deepEqual(results,['changed file']);
 const next=watcher.run(300000);assert.equal(calls,2);resolve('new revision');await next;
 await watcher.run();assert.equal(calls,2);now+=60000;const revisit=watcher.run();resolve('returned');await revisit;assert.equal(calls,3);
});
test('failures back off, project keys stay separate, disposed views receive no late updates',async()=>{
 const attempts={},pending=new Set();let now=0,failed=0,calls=0;
 const options={attempts,pending,available:()=>true,now:()=>now,refresh:async()=>{calls++;throw Error('offline storage');},updated:()=>assert.fail('unexpected update'),failed:()=>failed++};
 const a=sourceRefresher({...options,key:'tenant-project-A'});await a.run();await a.run();assert.equal(calls,1);assert.equal(failed,1);
 const b=sourceRefresher({...options,key:'tenant-project-B'});await b.run();assert.equal(calls,2);now=60000;await a.run();assert.equal(calls,3);
 let resolve;const c=sourceRefresher({...options,key:'later',refresh:()=>new Promise(r=>resolve=r),failed:()=>assert.fail('late callback')});const work=c.run();c.dispose();resolve('late result');await work;assert.equal(pending.size,0);await c.run();
});
