const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const m={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/transcript-merge.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:m});
const u=(c)=>({role:'user',content:c}),a=(c)=>({role:'assistant',content:c});
test('a newer copy that extends the other wins without duplication',()=>{
 assert.deepEqual([...m.mergeTranscripts([u('q')],[u('q'),a('x')]).map(x=>x.content)],['q','x']);
 assert.deepEqual([...m.mergeTranscripts([u('q'),a('x')],[u('q')]).map(x=>x.content)],['q','x']);
});
test('diverged copies keep the shared start, then the other device’s turns, then ours',()=>{
 const theirs=[u('q'),a('laptop answer'),u('laptop follow-up')];
 const ours=[u('q'),a('phone answer')];
 assert.deepEqual([...m.mergeTranscripts(theirs,ours).map(x=>x.content)],['q','laptop answer','laptop follow-up','phone answer']);
});
test('identical copies merge to themselves',()=>{
 const same=[u('q'),a('x')];assert.equal(m.mergeTranscripts(same,same.map(x=>({...x}))).length,2);
});
const roles=(t)=>t.map(x=>x.role).join(',');
test('two answers to the same question keep one, so roles still alternate',()=>{
 const out=m.mergeTranscripts([u('q'),a('short')],[u('q'),a('a longer answer')]);
 assert.equal(roles(out),'user,assistant');assert.equal(out[1].content,'a longer answer');
 const tie=m.mergeTranscripts([u('q'),a('theirs')],[u('q'),a('oursxx')]);assert.equal(tie[1].content,'oursxx');
 const theirsLonger=m.mergeTranscripts([u('q'),a('the much longer answer')],[u('q'),a('x'),u('next')]);
 assert.deepEqual([...theirsLonger.map(x=>x.content)],['q','the much longer answer','next']);
});
test('when the other device went further, its answer stays and every user turn survives',()=>{
 const out=m.mergeTranscripts([u('q'),a('laptop'),u('q2'),a('laptop 2')],[u('q'),a('phone'),u('q3')]);
 assert.equal(roles(out),'user,assistant,user,assistant,user');
 assert.deepEqual([...out.map(x=>x.content)],['q','laptop','q2','laptop 2','q3']);
});
