// Pure rules of the guided model manager (#204): estimate math, verdict, recommendation,
// the Q5 floor (#190), roles and the recovery list. Synthetic numbers in realistic ranges.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const loaded={};
function load(file){file=path.normalize(file);if(loaded[file])return loaded[file].exports;const full=path.join(__dirname,'../../src',file);const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};loaded[file]=m;
  const req=(id)=>id.startsWith('.')?load(path.relative(path.join(__dirname,'../../src'),path.join(path.dirname(full),id))+'.ts'):require(id);
  new Function('module','exports','require',code)(m,m.exports,req);return m.exports;}
const g=load('components/models/guided.ts');

// ~9B Q5 hybrid model: 6.2 GiB file, ~0.5 GiB of q8 KV per 32K tokens.
const rows=[4096,8192,16384,32768,65536,131072,262144].map(ctx=>({ctx,kvQ8Gib:Math.round(ctx/32768*0.5*100)/100}));
const nine={model:'Synthetic-9B-Q5',budgetGib:null,chat:true,sizeable:true,arch:'qwen35',nativeCtx:262144,modelGib:6.2,pinnedGib:0,reserveGib:1,safety:1.05,moe:false,rows,current:{ctx:16384,kv:'q8_0'}};

test('estimate adds model, rescaled KV, projector and reserve, then the 5% margin',()=>{
  const q8=g.estimateGib(nine,32768,'q8_0');
  assert.deepEqual(q8,{ctx:32768,kv:'q8_0',kvGib:0.5,totalGib:Math.round((6.2+0.5+0+1)*1.05*100)/100});
  const f16=g.estimateGib(nine,32768,'f16'),q5=g.estimateGib(nine,32768,'q5_0');
  assert.ok(Math.abs(f16.kvGib-0.5*2/1.0625)<0.01);assert.ok(Math.abs(q5.kvGib-0.5*0.6875/1.0625)<0.01);
  assert.equal(g.estimateGib(nine,20000,'q8_0').ctx,32768,'snaps up to the next verified rung');
  assert.equal(g.estimateGib(nine,32768,'bogus'),null);
  assert.equal(g.estimateGib({...nine,pinnedGib:1.4},32768,'q8_0').totalGib,Math.round((6.2+0.5+1.4+1)*1.05*100)/100);
});

test('#697: the preset prompt cache is added after the margin, like the server load guard',()=>{
  const withCache={...nine,cacheRamGib:1};
  assert.equal(g.estimateGib(withCache,32768,'q8_0').totalGib,Math.round(((6.2+0.5+0+1)*1.05+1)*100)/100);
  assert.equal(g.estimateGib({...nine,cacheRamGib:null},32768,'q8_0').totalGib,g.estimateGib(nine,32768,'q8_0').totalGib,'unknown cache: unchanged');
  // The recommendation floor counts it too, so a model that only fits without its cache is not offered.
  const rec=g.recommend({...withCache,modelGib:7.6},10);
  assert.equal(rec.kind,'smaller');assert.equal(rec.floorGib,Math.round(((7.6+1)*1.05+1)*100)/100);
});

test('verdict: fits with headroom, tight within 10% (at least 1 GiB), no when over',()=>{
  assert.equal(g.verdictFor(10,14),'fits');assert.equal(g.verdictFor(13.2,14),'tight');assert.equal(g.verdictFor(14.1,14),'no');
  assert.equal(g.verdictFor(57,64),'fits');assert.equal(g.verdictFor(59,64),'tight');
  assert.equal(g.tightMargin(4),1);
});

test('budget prefers the configured budget, then the largest GPU incl. shared memory, then RAM',()=>{
  assert.equal(g.budgetFor(14,null).gib,14);
  const hw={systemGB:64,gpus:[{name:'Synthetic iGPU',capacityGB:4,sharedGB:28},{name:'Small',capacityGB:8,sharedGB:null}]};
  assert.deepEqual(g.budgetFor(null,hw),{gib:32,source:'Synthetic iGPU (dedicated + shared memory)',kind:'gpu-shared',gpu:'Synthetic iGPU'});
  // kind (and gpu) let the panel phrase the source in the interface language (#293).
  assert.equal(g.budgetFor(14,null).kind,'configured');assert.equal(g.budgetFor(null,{systemGB:32,gpus:[]}).kind,'system');
  assert.equal(g.budgetFor(null,{systemGB:32,gpus:[]}).gib,32);
  assert.equal(g.budgetFor(null,{systemGB:null,gpus:[]}),null);
});

test('recommendation keeps q8_0 at the largest comfortable context and never goes below Q5 (#190)',()=>{
  const r=g.recommend(nine,14);
  assert.equal(r.kind,'use');assert.equal(r.kv,'q8_0');assert.equal(r.verdict,'fits');
  assert.ok(g.verdictFor(g.estimateGib(nine,r.ctx,'q8_0').totalGib,14)==='fits');
  // Wanting more context than q8_0 reaches drops to Q5, not Q4.
  const tightBudget=10.2, want=131072;
  const q8=g.recommend(nine,tightBudget);assert.equal(q8.kv,'q8_0');assert.ok(q8.ctx<want);
  const q5=g.recommend(nine,tightBudget,want);assert.ok(['q5_1','q5_0'].includes(q5.kv),q5.text);assert.ok(q5.ctx>=want);
  for(const budget of [8.8,9,9.5,10,12,20,40])for(const want of [0,65536,262144]){const x=g.recommend(nine,budget,want);if(x.kind==='use')assert.ok(!g.belowKvFloor(x.kv),`${budget}/${want}: ${x.kv}`);}
  const huge=g.recommend({...nine,modelGib:20,moe:true},14);
  assert.equal(huge.kind,'smaller');assert.match(huge.text,/smaller quantization or configure CPU expert offload/);assert.equal(huge.moe,true);assert.ok(huge.floorGib>14);
  assert.equal(g.recommend({...nine,chat:false},14).kind,'unknown');
  assert.match(g.recommend({...nine,sizeable:false,rows:[]},14).text,/Measure context/);
});

test('below-floor detection covers q4 variants only',()=>{
  assert.equal(g.belowKvFloor('q4_0'),true);assert.equal(g.belowKvFloor('q4_1'),true);
  for(const kv of ['q5_0','q5_1','q8_0','f16',null,'mixed'])assert.equal(g.belowKvFloor(kv),false,String(kv));
});

test('tune duration grows with model size and stays a range',()=>{
  const small=g.tuneMinutes(2.5),big=g.tuneMinutes(12);
  assert.ok(small.low<small.high&&big.low<big.high);assert.ok(big.high>small.high);
  assert.ok(small.low>=5);assert.deepEqual(g.tuneMinutes(null),g.tuneMinutes(8));
  assert.deepEqual(g.TUNE_STEPS.map(s=>s.id),['sampling','kv','context','drafting','batch']);
});

test('roles: Laya is routing, embed/rerank excluded from the prompt suite, vision is chat',()=>{
  assert.equal(g.roleOf('laya_multilingual_f16',[]),'routing');
  assert.equal(g.roleOf('nomic-embed-text-v1.5',[]),'embedding');
  assert.equal(g.roleOf('vec-syn',['embeddings']),'embedding');
  assert.equal(g.roleOf('qwen3-reranker-0.6b',[]),'rerank');
  assert.equal(g.roleOf('Synthetic-9B',['vision']),'vision');
  assert.equal(g.roleOf('Synthetic-4B',[]),'chat');
  assert.deepEqual(['chat','vision','routing','embedding','rerank'].map(r=>g.canPromptSuite(r)),[true,true,false,false,false]);
  const groups=g.groupByRole([{name:'a',labels:[]},{name:'laya_x',labels:[]},{name:'b-embed',labels:[]}]);
  assert.deepEqual(groups.map(x=>[x.role,x.models.map(m=>m.name)]),[['chat',['a']],['routing',['laya_x']],['embedding',['b-embed']]]);
});

test('recovery lists failed, interrupted, resumable-cancelled and stale jobs with the right action',()=>{
  const now=Date.parse('2026-09-24T12:00:00Z');
  const items=g.recoveryItems({now,
    autotune:{id:'t1',model:'Synthetic-20B',status:'failed',error:'No KV cache type passed quality and throughput checks.',models:[{}]},
    calibration:{id:'c1',model:'Synthetic-4B',status:'running',startedAt:now-3*3600e3,phase:'Loading 32768'},
    downloads:[{id:'d1',filename:'x.gguf',status:'error',error:'HTTP 503'},{id:'d2',filename:'y.gguf',status:'done'}]});
  assert.deepEqual(items.map(i=>[i.kind,i.status,i.actions.join()]),[['autotune','failed','resume'],['calibration','running for over 2 hours','cancel'],['download','failed','discover']]);
  assert.equal(g.recoveryItems({now,autotune:{status:'running',startedAt:now-60e3},calibration:{status:'passed'},downloads:[]}).length,0);
  assert.equal(g.recoveryItems({now,autotune:{status:'cancelled',model:'m'},calibration:{status:'cancelled',model:'m'},downloads:[]}).length,0,'a plain cancel is not a problem');
  assert.deepEqual(g.recoveryItems({now,autotune:null,calibration:{status:'failed',model:'laya_multilingual_f16'},downloads:[]})[0].actions,[],'Laya is never offered a retry');
  assert.deepEqual(g.recoveryItems({now,autotune:{status:'interrupted',model:'m'},calibration:null,downloads:[]})[0].actions,['retry'],'a legacy run without phases restarts');
});

test('#551: a finished run for a model that is no longer installed is not offered for recovery; installed models and unknown lists are unaffected',()=>{
  const now=Date.parse('2026-09-28T12:00:00Z');
  const stale={id:'t1',model:'synthetic-20b-Q4_K_M',status:'failed',error:'No KV cache type passed quality and throughput checks.',models:[{}]};
  assert.equal(g.recoveryItems({now,autotune:stale,calibration:null,downloads:[],installed:['Synthetic-4B']}).length,0,'uninstalled: no Resume');
  assert.deepEqual(g.recoveryItems({now,autotune:stale,calibration:null,downloads:[],installed:['Synthetic-4B','synthetic-20b-Q4_K_M']}).map(i=>i.actions.join()),['resume'],'installed: history kept');
  assert.equal(g.recoveryItems({now,autotune:stale,calibration:null,downloads:[],installed:null}).length,1,'an unreadable model list never hides a real problem');
  assert.equal(g.recoveryItems({now,autotune:stale,calibration:null,downloads:[]}).length,1,'no list supplied: unchanged');
  assert.deepEqual(g.recoveryItems({now,autotune:{...stale,status:'running',startedAt:now-3*3600e3},calibration:null,downloads:[],installed:[]}).map(i=>i.actions.join()),['cancel'],'a stuck running job can always be cancelled');
  assert.equal(g.recoveryItems({now,autotune:null,calibration:{id:'c',model:'old',status:'failed'},downloads:[{id:'d',filename:'x.gguf',status:'error'}],installed:[]}).length,1,'stale calibration dropped, failed download kept');
});

test('the guided flow keeps the Laya guard and never starts a run by itself (#80/#81/#83)',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../../src/components/models/GuidedOptimize.tsx'),'utf8');
  const guard=src.indexOf('if (isSystemModel(model)) return'),steps=src.indexOf('<FitStep');
  assert.ok(guard>0&&guard<steps,'the system model returns before any step renders');
  assert.doesNotMatch(src,/method: 'POST'/,'estimate, pre-flight and quality only read');
  const overview=fs.readFileSync(path.join(__dirname,'../../src/components/models/OverviewTab.tsx'),'utf8');
  assert.match(overview,/g\.role !== 'routing' && <button/,'no Optimize or Details button for the routing model');
});

test('the model manager phrases every recommendation kind exactly like guided.ts text (en-US), so the two cannot drift (#293)',()=>{
  const core=load('i18n/core.ts');load('i18n/models/index.ts');
  // en-US shares the spelling of guided.ts ("quantization"); en-GB differs only there. The sizes carry
  // their own unit now (#636: the catalogue never prints one), which the panel passes in ready-made.
  const say=(rec,budget)=>rec.kind==='use'?core.translate('en-US',rec.verdict==='tight'?'mm.fit.rec.useTight':'mm.fit.rec.use',{ctx:rec.ctx.toLocaleString('en-US'),kv:rec.kv,total:`${rec.totalGib} GiB`,budget:`${budget} GiB`})
    :rec.kind==='smaller'?core.translate('en-US',rec.moe?'mm.fit.rec.smallerMoe':'mm.fit.rec.smaller',{floor:`${rec.floorGib} GiB`,budget:`${budget} GiB`})
    :rec.reason==='not-chat'?core.translate('en-US','mm.fit.rec.notChat'):core.translate('en-US','mm.fit.rec.noLayout',{arch:rec.arch||core.translate('en-US','mm.fit.unknownArch')});
  const cases=[[nine,14],[nine,10.2],[{...nine,modelGib:20,moe:true},14],[{...nine,modelGib:20},14],[{...nine,chat:false},14],[{...nine,sizeable:false,rows:[]},14],[{...nine,sizeable:false,rows:[],arch:''},14]];
  const kinds=new Set();
  for(const [inputs,budget] of cases){const rec=g.recommend(inputs,budget);kinds.add(rec.kind+(rec.verdict||rec.reason||(rec.moe?'moe':'')));assert.equal(say(rec,budget),rec.text);}
  assert.ok(kinds.size>=5,[...kinds].join());
  assert.match(core.translate('en-GB','mm.fit.rec.smaller',{floor:1,budget:2}),/quantisation/);
});

test('tuning pre-flight lists the sampling step first and formats the recommended values in a fixed order (#308)',()=>{
  assert.equal(g.TUNE_STEPS[0].id,'sampling');
  const plan=g.parseSamplingPlan({tier:'family',source:'Qwen3 family table',values:{top_k:20,temperature:0.6,min_p:0,top_p:0.95,junk:1,repeat_penalty:'x'},family:'qwen3',note:'thinking-mode values'});
  assert.deepEqual(g.samplingValueList(plan),['temperature 0.6','top_p 0.95','top_k 20','min_p 0']);
  assert.equal(plan.family,'qwen3');assert.equal(plan.note,'thinking-mode values');
  assert.deepEqual(g.samplingValueList(g.parseSamplingPlan({tier:'preset',source:'Task preset: general',values:{}})),[]);
  for(const bad of [null,undefined,{},{tier:'guess',source:'x',values:{}},{tier:'family',values:{}},{tier:'family',source:'x'},'text'])assert.equal(g.parseSamplingPlan(bad),null,JSON.stringify(bad));
  assert.deepEqual(g.samplingValueList(null),[]);
});

test('the sampling source and note translate from stable ids, and old server strings still map (#565)',()=>{
  const core=load('i18n/core.ts');load('i18n/models/index.ts');
  const fresh=g.parseSamplingPlan({tier:'family',source:'Qwen3.5 family table',sourceId:'family-table',values:{temperature:1},family:'qwen3.5',familyLabel:'Qwen3.5',note:'thinking-mode values',noteId:'thinking-mode'});
  assert.deepEqual(g.samplingPlanParts(fresh),{familyName:'Qwen3.5',note:'thinking-mode',rawNote:null});
  // A server that predates the ids: the English strings are recognised instead.
  const legacy=g.parseSamplingPlan({tier:'family',source:'Gemma 4 family table',values:{temperature:1},family:'gemma-4',note:'thinking-mode values'});
  assert.deepEqual(g.samplingPlanParts(legacy),{familyName:'Gemma 4',note:'thinking-mode',rawNote:null});
  const other=g.parseSamplingPlan({tier:'family',source:'Phi-4 family table',values:{temperature:0.8},family:'phi-4',note:'something new'});
  assert.deepEqual(g.samplingPlanParts(other),{familyName:'Phi-4',note:null,rawNote:'something new'});
  assert.equal(g.samplingPlanParts(g.parseSamplingPlan({tier:'model-card',source:'generation_config.json',values:{temperature:1}})).familyName,null);
  // Every locale catalogue carries both keys, translated (a locale's tune.sampling.tier.family sentence is the English reference).
  const dir=path.join(__dirname,'../../src/i18n/models');
  const en=fs.readFileSync(path.join(dir,'en-GB.ts'),'utf8');
  const enSentence=/'mm\.tune\.sampling\.tier\.familyNamed': '([^']+)'/.exec(en)[1];
  for(const locale of ['de-DE','es-ES','fr-FR','it-IT','nb-NO','nl-NL','pt-BR','sv-SE']){
    const text=fs.readFileSync(path.join(dir,locale+'.ts'),'utf8');
    const sentence=new RegExp('\'mm\\.tune\\.sampling\\.tier\\.familyNamed\': "([^"]+)"').exec(text)?.[1];
    assert.ok(sentence,locale+' has the family sentence');assert.match(sentence,/\{family\}/,locale);
    assert.notEqual(sentence,enSentence,locale+' is translated');assert.doesNotMatch(sentence,/family table/i,locale);
    const note=new RegExp('\'mm\\.tune\\.sampling\\.note\\.thinkingMode\': "([^"]+)"').exec(text)?.[1];
    assert.ok(note&&!/thinking/i.test(note),locale+' translates the note');
  }
  assert.equal(core.translate('en-GB','mm.tune.sampling.tier.familyNamed',{family:'Qwen3.5'}),enSentence.replace('{family}','Qwen3.5'));
});

// #328: the Tune panel after the 2026-09-30 E2B run (job bb20d010's shape, synthetic values).
const e2bRun=[{phases:[
  {id:'sampling',status:'passed',value:{skipped:true,failed:true,reason:'Quality checks failed: arithmetic (mismatch).'}},
  {id:'kv',status:'failed'},{id:'context',status:'pending'},{id:'drafting',status:'pending'},{id:'batch',status:'pending'}]}];
test('#328 an optional sampling step that did not apply reads not applied or skipped, never passed',()=>{
  assert.equal(g.phaseState(e2bRun[0].phases[0]),'not-applied');
  assert.equal(g.phaseState({id:'sampling',status:'passed',value:{skipped:true,reason:'No recommended sampling values'}}),'skipped');
  assert.equal(g.phaseState({id:'sampling',status:'passed',value:{applied:true}}),'passed');
  assert.equal(g.phaseState({id:'kv',status:'passed',value:{kv:'q8_0'}}),'passed');
  assert.equal(g.phaseState({id:'sampling',status:'failed'}),'failed');
});
test('#328 progress counts only settings a run applied',()=>{
  assert.deepEqual(g.appliedSettings(e2bRun),{done:0,total:4});
  const done=[{phases:[{id:'sampling',status:'passed',value:{applied:true}},...['kv','context','drafting','batch'].map(id=>({id,status:'passed',value:{}}))]}];
  assert.deepEqual(g.appliedSettings(done),{done:5,total:5});
  assert.deepEqual(g.appliedSettings([...e2bRun,...done]),{done:5,total:9});
});
test('#328 a server sentence inside a catalogue sentence loses its own full stop only',()=>{
  assert.equal(g.withoutFinalStop('No KV cache type passed quality and throughput checks.'),'No KV cache type passed quality and throughput checks');
  assert.equal(g.withoutFinalStop('Answered arithmetic: "69".. '),'Answered arithmetic: "69"');
  assert.equal(g.withoutFinalStop('Cancelled'),'Cancelled');
  assert.equal(g.withoutFinalStop('v1.5 is loaded'),'v1.5 is loaded');
});
test('#328 the floor note lists the server\'s own KV candidates, else this build\'s default',()=>{
  assert.deepEqual(g.kvCandidatesFrom(['f16','q8_0','q5_1','q5_0','q4_0']),['f16','q8_0','q5_1','q5_0','q4_0']);
  assert.deepEqual(g.kvCandidatesFrom(undefined),['f16','q8_0','q5_1','q5_0']);
  assert.deepEqual(g.kvCandidatesFrom(['f16','<b>']),['f16','q8_0','q5_1','q5_0'],'unknown types are not trusted');
  assert.ok(!g.kvCandidatesFrom(undefined).some(g.belowKvFloor));
});
test('#328 model names are listed once',()=>{
  assert.deepEqual(g.uniqueNames(['a','b','a','c','b']),['a','b','c']);
});
