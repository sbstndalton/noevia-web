// Settings → Models & routing against synthetic model-manager and engine APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'/tmp';
(async()=>{
 const fixture=createFixture(31341);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:950}});await page.emulateMedia({reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const calls=[];let saveAttempts=0,revision='r1',deleted=[],reloads=[],safeDefaults=[],downloadBodies=[],logPolls=0,badges=[],extraJob=null,extraRegistered=false,prompts=[{id:1,name:'Short answer',body:'Reply with OK.'}],benchStarted=null;
 const now=Date.now()/1000,hist=Array.from({length:40},(_,i)=>({ts:now-(39-i)*2,gpu_util:i%10*9,vram_used_gb:0.15,cpu_pct:40+i%5*10,mem_used_gb:1.2,shared_used_gb:6+i*0.1,temp_c:48,power_w:18+i%4,per_gpu_util:[],per_gpu_vram_used_gb:[]}));
 const hostHist=hist.map(p=>({ts:p.ts,cpu_pct:12,mem_used_gb:14.5,mem_total_gb:29,mem_available_gb:14.5}));
 const schema=[{tier:'Common',open:true,fields:[{key:'model',label:'Model file',kind:'text',choices:[],placeholder:'',help:'Model path'},{key:'ctx-size',label:'Context size',kind:'int',choices:[],placeholder:'8192',help:'Tokens'},{key:'ngl',label:'GPU layers',kind:'text',choices:[],placeholder:'999',help:''},{key:'flash-attn',label:'Flash attention',kind:'select',choices:['','on','off','auto'],placeholder:'',help:''},{key:'jinja',label:'Enable --jinja templating',kind:'bool',choices:[],placeholder:'',help:''}]},{tier:'Multimodal / vision',open:false,fields:[{key:'mmproj',label:'Projector',kind:'text',choices:[],placeholder:'',help:''}]}];
 const rec={plans:[{name:'cowork-llama-1',vendor:'vulkan',vram_gb:14,max_ctx:262144,fits_at_all:true,rows:[8192,32768,65536,131072,262144].map((ctx,i)=>({ctx,total_ctx:ctx,model_gb:5.56,kv_gb:[0.14,0.53,1.06,2.12,4.25][i],total_gb:[7.5,7.9,8.4,9.5,11.6][i],fits:true,free_gb:2,offload_kind:'',n_cpu_moe:0,gpu_pct:100}))}],
  recommended_backend:'cowork-llama-1',recommended_ctx:262144,recommended_total_ctx:262144,n_sessions:1,values:{'ctx-size':'262144',ngl:'999','flash-attn':'on',jinja:'true'},quirks:['Synthetic quirk.'],unavailable:[],current_diff:['ctx-size: 32768 → 262144'],displaced:['mmproj'],
  presets:[{key:'fast',label:'Fast',ctx:131072,n_cpu_moe:0,offload_kind:'',gpu_layers:32,total_layers:32,gpu_gb:5.5,kv_gb:2,speed_score:1,ngl:999},{key:'long-ctx',label:'Long context',ctx:262144,n_cpu_moe:0,offload_kind:'ngl',gpu_layers:30,total_layers:32,gpu_gb:5.2,kv_gb:4,speed_score:0.62,ngl:30}],
  frontier:[{key:'pt0',label:'',ctx:131072,n_cpu_moe:0,offload_kind:'',gpu_layers:32,total_layers:32,gpu_gb:5.5,kv_gb:2,speed_score:1,ngl:999},{key:'pt1',label:'',ctx:196608,n_cpu_moe:0,offload_kind:'ngl',gpu_layers:31,total_layers:32,gpu_gb:5.3,kv_gb:3,speed_score:0.8,ngl:31},{key:'pt2',label:'',ctx:262144,n_cpu_moe:0,offload_kind:'ngl',gpu_layers:30,total_layers:32,gpu_gb:5.2,kv_gb:4,speed_score:0.62,ngl:30}],
  fits_full_gpu:false,native_ctx:262144,warnings:['IQ3_XXS is below Q4; on a model this size that usually costs more quality than the memory it saves.'],estimated_ctx:1048576,ctx_cap_reason:'prompt speed not measured yet; measure context to go higher',current_preset:'',active_preset:'fast',spec_profiles:[{key:'off',label:'Off',blurb:'No speculation.',spec_type:'',needs_head:false},{key:'balanced',label:'Balanced',blurb:'Needs a head.',spec_type:'draft-mtp',needs_head:true}],active_spec_profile:'off',current_spec_profile:'off',spec_head_rel:'',error:'',vision_available:'/models/q/mmproj.gguf',vision:true};
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,m=req.method();calls.push(`${m} ${p}`);
  const json=(body,status=200)=>route.fulfill({status,json:body});
  const body=()=>{try{return req.postDataJSON();}catch{return {};}};
  if(p==='/api/profile'||p==='/api/auth/session')return json({user:{id:'qa',username:'admin',displayName:'Synthetic admin',role:'admin',diaryEnabled:true,onboarded:true},passkeys:[]});
  if(p==='/api/models/capabilities')return json({kind:'llamacpp',admin:true,presets:true,download:true,runtimeOptions:false,modelManagement:true});
  if(p==='/api/models/installed')return json([{name:'Qwen-9B',labels:['vision'],loaded:true,sizeGB:5.6,maxContext:262144,source:'preset',canDelete:false,status:'loaded'},{name:'Gemma-E2B',labels:[],loaded:false,sizeGB:3,maxContext:131072,source:'preset',canDelete:false,status:'unloaded'},...(extraRegistered?[{name:'new-model-Q4_K_M',labels:[],loaded:false,sizeGB:2,maxContext:8192,source:'preset',canDelete:false,status:'unloaded'}]:[])]);
  if(p==='/api/models/autotune')return json({history:[],job:{id:'t1',model:'Qwen-9B',status:'passed',phase:'Done',steps:[
   {kind:'spec',id:'off',label:'Off',status:'measured',score:19.1,workloads:[{workload:'list',gen:19,drafted:0,accepted:0},{workload:'prose',gen:19.2,drafted:0,accepted:0},{workload:'code',gen:19.1,drafted:0,accepted:0}]},
   {kind:'spec',id:'mtp',label:'MTP (engine defaults)',status:'measured',score:33.4,workloads:[{workload:'list',gen:40.2,drafted:84,accepted:82},{workload:'prose',gen:23.2,drafted:144,accepted:59},{workload:'code',gen:36.9,drafted:120,accepted:96}]},
   {kind:'spec',id:'ngram',label:'N-gram',status:'rejected',reason:'Changed the deterministic list output.',score:20},
   {kind:'prompt',id:'ubatch-1024',label:'Micro-batch 1024',status:'measured',promptPerSecond:531,reused:true}],progress:{done:4,total:8,percent:50},
   result:{spec:'mtp',specLabel:'MTP (engine defaults)',generation:33.4,generationOff:19.1,gain:75,perWorkload:{list:'mtp',prose:'mtp',code:'mtp'},ubatch:1024,promptPerSecond:531,
    extensions:[{id:'context',action:'calibrate',from:32768,to:63720,why:'measured prompt speed (531 tokens/s) fills about 63,720 tokens within 120 s'}]},calibration:'started'}});
  if(p==='/api/models/calibration')return json({job:null,history:[]});
  if(p.endsWith('/draft-heads'))return json({section:'Qwen-9B',local:'',builtinLayers:1,available:true,remote:[],mtpBuild:null,repo:null,modes:{}});
  if(p==='/api/models/presets/reload'){const b=body();reloads.push(b);return b.unload?json({reloaded:true,unloaded:['Qwen-9B']}):json({error:'A model is loaded.',loaded:['Qwen-9B']},409);}
  if(p==='/api/auto-roles'&&m==='GET')return json({configured:true,roles:{fast:'Qwen-9B',smart:'Gemma-4-E4B-it-GGUF'},missing:[{role:'smart',model:'Gemma-4-E4B-it-GGUF'}]});
  if(!p.startsWith('/api/model-manager/'))return p.startsWith('/api/models/')?json([]):route.continue();
  const r=p.slice('/api/model-manager/'.length);
  if(r==='models')return json({models:[
   {key:'q/Qwen-9B.gguf',name:'Qwen-9B.gguf',subdir:'q',bytes:5.6e9,size:'5.6 GB',modified:'2026-09-01',sharded:false,parts:1,projector:{name:'mmproj.gguf',bytes:9e8},sections:['Qwen-9B'],modelId:'Qwen-9B',file:'q/Qwen-9B.gguf',shape:{arch:'qwen35',moe:false,experts:0,active:0,label:'dense'},loadedOn:['cowork-llama-1'],fit:[],badges:badges.filter(b=>b.alias==='Qwen-9B')},
   {key:'g/Gemma-E2B.gguf',name:'Gemma-E2B.gguf',subdir:'g',bytes:3e9,size:'3.0 GB',modified:'2026-09-01',sharded:false,parts:1,projector:null,sections:['Gemma-E2B'],modelId:'Gemma-E2B',file:'g/Gemma-E2B.gguf',shape:{arch:'gemma4',moe:false,experts:0,active:0,label:'dense'},loadedOn:[],fit:[],badges:[]},
   {key:'n/new-model-Q4_K_M.gguf',name:'new-model-Q4_K_M.gguf',subdir:'n',bytes:2e9,size:'2.0 GB',modified:'2026-09-14',sharded:false,parts:1,projector:null,sections:[],modelId:'new-model-Q4_K_M',file:'n/new-model-Q4_K_M.gguf',shape:null,loadedOn:[],fit:[],badges:[]},
  ].filter(f=>!deleted.includes(f.key)),unregistered:['new-model-Q4_K_M'],revision});
  if(r==='download-targets')return json({targets:[{id:'',label:'Models folder',path:'/models'},{id:'archive',label:'archive',path:'/models/archive'}]});
  if(r==='overview')return json({modelsDir:{path:'/models',hostPath:'/mnt/user/ai-models',exists:true,disk:{total:5e11,free:1.5e11,usedPct:70,totalH:'465.7 GB',freeH:'139.7 GB'}},models:3,sections:2,backends:[],activeDownloads:0,revision});
  if(r==='models/updates')return json({status:{'Gemma-E2B.gguf':{status:'stale',remote:'2026-09-10',delta_days:9}}});
  if(r==='models/detail')return json({key:'g/Gemma-E2B.gguf',name:'Gemma-E2B.gguf',file:'g/Gemma-E2B.gguf',modified:'2026-09-01',sharded:false,parts:1,projector:null,path:'/models/g/Gemma-E2B.gguf',summary:{arch:'gemma4',general:{params:'5.1 B',quant:'Q4_K_M'},model:{context_length:131072,block_count:35,attention_head_count:8,attention_head_count_kv:1},chat_template_features:{uses_think_tags:true}}});
  if(r==='models/delete'){deleted.push(...body().models);return json({results:[{key:body().models[0],ok:true,message:'deleted',freed:3e9,freedH:'3.0 GB'}]});}
  if(r==='sections'&&m==='GET')return json({revision,schema,sections:[{name:'Qwen-9B',items:[['model','/models/q/Qwen-9B.gguf'],['ctx-size','32768']],hasFile:true,file:'q/Qwen-9B.gguf',cli:'llama-server -m /models/q/Qwen-9B.gguf'},{name:'Gemma-E2B',items:[],hasFile:true,file:'g/Gemma-E2B.gguf',cli:'llama-server -m g'}],unregistered:['new-model-Q4_K_M'],backups:[['models.ini.bak-1',now,100]],raw:'version = 1\n\n[Qwen-9B]\nmodel = /models/q/Qwen-9B.gguf\n'});
  if(r.startsWith('sections/')&&r.endsWith('/autoconfig'))return json({section:'Qwen-9B',arch:'qwen35',params:'9.0 B',fileBytes:5.6e9,model:'/models/q/Qwen-9B.gguf',recommendation:{...rec,vision:url.searchParams.get('vision')!=='false'},measured:{n:12,gen_p50:13.7,gen_p25:12.9,gen_p75:14.2,prompt_p50:310,draft_acc_p50:null},history:[]});
  if(r.endsWith('/safe-defaults')&&m==='POST'){safeDefaults.push(decodeURIComponent(r.split('/')[1]));return r.includes('later-model')?json({ok:true,revision,mtp:true}):json({error:'Synthetic manager failure'},502);}
  if(r.startsWith('sections/')&&m==='DELETE'){revision='r-del';return json({ok:true,revision});}
  if(r.startsWith('sections/')&&m==='GET'){const name=decodeURIComponent(r.split('/')[1].split('?')[0]);return json({name,exists:name!=='new-model-Q4_K_M',values:name==='new-model-Q4_K_M'?{model:'/models/n/new-model-Q4_K_M.gguf','ctx-size':'8192'}:{model:'/models/q/Qwen-9B.gguf','ctx-size':'32768',mmproj:'/models/q/mmproj.gguf'},extras:'',hints:name==='new-model-Q4_K_M'?['Defaults from the model file.']:[],revision,schema});}
  if(r.startsWith('sections/')&&m==='PUT'){saveAttempts++;const b=body();if(saveAttempts===1)return json({error:'models.ini changed since you loaded it.'},409);assert.equal(b.baseRevision,revision);assert.equal(b.values['ctx-size'],'262144');assert.equal(b.values.mmproj,'');revision='r2';return json({ok:true,revision});}
  if(r==='backends')return json({backends:[{name:'cowork-llama-1',found:true,status:'running',image:'ghcr.io/ggml-org/llama.cpp:server-vulkan',uptime:'3h',started_at:'x',loaded_model:'Qwen-9B',probe_error:null,last_restart_error:null,
   stats:{ok:true,error:null,gpu:{vendor:'vulkan',name:'AMD Radeon 880M/890M',util_pct:62,vram_used_gb:0.15,vram_total_gb:2,temp_c:48,power_w:19,gpu_count:1,cards:[],memory_kind:'unified',shared_used_gb:9.8,shared_total_gb:14.5,clock_mhz:2900,source:'sysfs',measured:true},container:{cpu_pct:55,mem_used_gb:1.2,mem_limit_gb:14}},history:hist}]});
  if(r==='host')return json({current:hostHist.at(-1),history:hostHist});
  if(r.endsWith('/diagnose'))return json({failures:[{model:'Big-Model',status:1,cause:'gpu-memory',title:'The GPU ran out of memory',advice:'Lower the context size.',evidence:['ggml_vulkan: Device memory allocation failed']}]});
  if(r.endsWith('/logs')){logPolls++;return json({ok:true,lines:url.searchParams.get('q')?['matching synthetic line']:Array.from({length:60+logPolls},(_,i)=>`line ${i}`)});}
  if(r.endsWith('/restart'))return json({ok:true,message:''});
  if(r.endsWith('/test'))return json({ok:true,reply:'Synthetic reply.',model:'Qwen-9B',completion_tokens:4,elapsed_s:0.4,tokens_per_s:13.7,prompt_tokens:12});
  if(r==='prompts'&&m==='GET')return json({prompts});
  if(r==='prompts'&&m==='POST'){const b=body();prompts=[...prompts,{id:prompts.length+1,...b}];return json({id:prompts.length,prompts});}
  if(r.startsWith('prompts/')&&m==='DELETE'){prompts=prompts.filter(x=>String(x.id)!==r.split('/')[1]);return json({prompts});}
  if(r==='settings')return json({hasToken:false,tokenHint:''});
  if(r.startsWith('search/repo'))return json({repo:'synthetic/model-GGUF',groups:[{shardBase:'model-Q4_K_M.gguf',shards:null,bytes:5e9,size:'4.7 GiB',quant:'Q4_K_M',projector:false,fit:[{name:'cowork-llama-1',verdict:'fits',ratio_pct:40}],files:[{path:'model-Q4_K_M.gguf',bytes:5e9,size:'4.7 GiB'}],estimates:[{key:'fast',label:'Fast',ctx:131072,gpu_layers:32,total_layers:32,speed_pct:100,offload:false}],nativeCtx:262144},{shardBase:'mmproj-F16.gguf',shards:null,bytes:9e8,size:'0.9 GiB',quant:null,projector:true,fit:[],files:[{path:'mmproj-F16.gguf',bytes:9e8,size:'0.9 GiB'}]}],gated:''});
  if(r.startsWith('search')&&!r.startsWith('search/repo')){const qs=url.search;searchQueries.push(qs);
   const wide=/showUnsuitable=true/.test(qs), all=/trustedOnly=false/.test(qs);
   // A broad one-word query: the hub's top 30 are community fine-tunes, so the trusted
   // default leaves nothing on screen. This is the live-instance case from the roadmap.
   if(/q=gemma/.test(qs)&&!all)return json({results:[],budgetGb:13.5,hubUrl:'https://huggingface.co/models?filter=gguf&search=gemma&sort=trending',counts:{found:30,shown:0,hiddenUntrusted:30,hiddenUnsuitable:0}});
   if(/q=gemma/.test(qs))return json({results:[{id:'fanclub/gemma-tune-GGUF',owner:'fanclub',downloads:12,likes:1,lastModified:'2026-09-02',ageDays:15,license:'apache-2.0',params:4,activeParams:null,moe:false,vision:false,trusted:false,suitable:true,reasons:[],options:[{path:'g-Q4_K_M.gguf',gb:3.1,quant:'Q4_K_M',shards:1,fits:true,reasons:[]}],best:{path:'g-Q4_K_M.gguf',gb:3.1,quant:'Q4_K_M',shards:1,fits:true,reasons:[]},downloaded:[]}],budgetGb:13.5,hubUrl:'https://huggingface.co/models?filter=gguf&search=gemma&sort=trending',counts:{found:30,shown:1,hiddenUntrusted:0,hiddenUnsuitable:0}});
   const rows=[{id:'synthetic/model-GGUF',owner:'synthetic',downloads:1234,likes:56,lastModified:'2026-09-01',ageDays:16,license:'apache-2.0',params:9,activeParams:null,moe:false,vision:true,trusted:true,suitable:true,reasons:[],options:[{path:'model-Q4_K_M.gguf',gb:5.2,quant:'Q4_K_M',shards:1,fits:true,reasons:[]}],best:{path:'model-Q4_K_M.gguf',gb:5.2,quant:'Q4_K_M',shards:1,fits:true,reasons:[]},downloaded:[]}];
   if(wide)rows.push({id:'stranger/huge-70B-GGUF',owner:'stranger',downloads:900000,likes:10,lastModified:'2026-09-10',ageDays:7,license:'mit',params:70,activeParams:null,moe:false,vision:false,trusted:false,suitable:false,reasons:['40.0 GB does not fit the 13.5 GB the GPU can hold'],options:[],best:null,downloaded:[]});
   return json({results:rows,budgetGb:13.5,hubUrl:'https://huggingface.co/models?filter=gguf&search=x&sort=trending',counts:{found:2,shown:rows.length,hiddenUntrusted:all?0:1,hiddenUnsuitable:wide?0:1}});}
  if(r==='downloads'&&m==='GET')return json({jobs:[{id:'j1',repo:'synthetic/model-GGUF',filename:'new-model-Q4_K_M/new-model-Q4_K_M.gguf',status:'done',error:null,bytes:2e9,downloaded:2e9,pct:100,speedH:'—',etaH:'—',parallel:true,chunks:[]},...(extraJob?[extraJob]:[])]});
  if(r==='downloads'&&m==='POST'){downloadBodies.push(body());return json({queued:['model-Q4_K_M.gguf','mmproj-F16.gguf']});}
  if(r==='benchmark')return json({sections:['Qwen-9B','Gemma-E2B'],sweepArgs:{},prompts,backends:['cowork-llama-1'],maxTokensDefault:3072,maxTokensCeiling:8192,job:{run_id:0,status:'idle',backend:'',total:0,done:0,current:'',error:'',unit:'requests',lines:[],pct:0,elapsed:0,eta:0,active:false},runs:[{id:7,backend:'cowork-llama-1',status:'done',started_at:now-600,finished_at:now-300,reps:3,max_tokens:512,note:''}],categories:[{key:'coding',label:'Coding'},{key:'writing',label:'Creative writing'}]});
  if(r==='benchmark/start'){benchStarted=body();return json({error:'A benchmark is already running.'},409);}
  if(r.startsWith('benchmark/runs/'))return json({run:{id:7,backend:'cowork-llama-1',status:'done',started_at:now-600},variants:[{alias:'Qwen-9B',load_ms:9000}],results:[{id:1,alias:'Qwen-9B',prompt_name:'Short answer',rep:1,cold:0,contended:0,err:'',ttft_ms:480,ttft_answer_ms:480,total_ms:900,prompt_n:12,gen_n:40,gen_tps:13.7,draft_acc:null,peak_vram_json:'[9.8]',truncated:0,response_text:'OK, synthetic.'}],sweeps:[],badges:{'Qwen-9B':badges},
   charts:{capacity_gb:14,aliases:['Qwen-9B'],gen:[{label:'Short answer',data:[13.7]}],ttft:[{label:'Short answer',data:[480]}],vram_labels:['Qwen-9B'],vram_measured:[9.8],vram_predicted:[9.1]}});
  if(r==='badges'&&m==='PUT'){const b=body();badges=[{alias:b.alias,category:b.category,rating:b.rating,note:b.note,run_id:b.runId}];return json({badges});}
  return json({});
 });
 await page.goto('http://localhost:31341');
 await page.getByTitle('Settings',{exact:true}).click();
 const settings=page.getByRole('region',{name:'Settings'});
 await settings.getByRole('button',{name:'Models & routing'}).click();
 // Settings keeps a summary only; managing models happens on its own page.
 await settings.getByText(/loaded: Qwen-9B/).waitFor();
 assert.equal(await settings.getByRole('tab',{name:'Your models'}).count(),0);
 await settings.getByRole('button',{name:'Open model manager'}).click();
 await settings.waitFor({state:'detached'});
 const dialog=page.locator('.model-manager-page');await dialog.waitFor();
 // One interface now: two tabs, an always-visible Routing section, and three
 // collapsed panels. The helpers keep the assertions below about behaviour
 // rather than about which tab something used to live in.
 const tab=async name=>{const back=dialog.getByRole('button',{name:'← All models'});if(await back.count())await back.click();await dialog.getByRole('tab',{name,exact:true}).click();};
 const yours=()=>tab('Your models');
 const discover=()=>tab('Discover');
 const searchQueries=[];
 const fold=async name=>{const d=dialog.locator('details.mm-fold').filter({has:page.locator(`> summary:has-text("${name}")`)});if(!await d.evaluate(el=>el.open))await d.locator('> summary').click();await page.waitForTimeout(120);};
 const openModel=async name=>{await dialog.getByRole('article',{name}).getByRole('button',{name:'Tune'}).click();await dialog.getByRole('button',{name:'← All models'}).waitFor();};
 const backToList=()=>dialog.getByRole('button',{name:'← All models'}).click();
 // Your models is the default tab.
 await yours();
 await dialog.getByRole('article',{name:'Gemma-E2B'}).waitFor();
 assert.ok(await dialog.getByText('Update available (2026-09-10)').isVisible());
 assert.equal(await dialog.getByTestId('models-disk').innerText(),'Models folder: 139.7 GB free of 465.7 GB (70% used).');
 const gemma=dialog.getByRole('article',{name:'Gemma-E2B'});
 await gemma.getByRole('button',{name:'Details'}).click();await gemma.getByText('gemma4',{exact:true}).waitFor();assert.ok(await gemma.getByText('5.1 B').isVisible());
 await gemma.getByRole('button',{name:'Delete',exact:true}).click();
 assert.ok(await gemma.getByText(/Delete Gemma-E2B.gguf \(3.0 GB\)/).isVisible());
 await gemma.getByRole('button',{name:'Delete files'}).click();
 await dialog.getByRole('article',{name:'Gemma-E2B'}).getByRole('button',{name:'Delete',exact:true}).waitFor();
 assert.deepEqual(deleted,['g/Gemma-E2B.gguf']);assert.ok(calls.includes('DELETE /api/model-manager/sections/Gemma-E2B'));
 await dialog.getByRole('button',{name:'Create settings'}).first().waitFor();
 // Configure via Library → Settings
 await dialog.getByRole('article',{name:'Qwen-9B'}).getByRole('button',{name:'Tune'}).click();
 await dialog.getByRole('heading',{name:'Qwen-9B',level:3}).waitFor();
 await dialog.getByText('Raw file & backups').click();
 assert.match(await dialog.getByLabel('models.ini contents').innerText(),/\[Qwen-9B\]/);
 assert.ok(await dialog.getByText(/models\.ini\.bak-1/).isVisible());
 if(process.env.QA_SCREENSHOTS)await page.screenshot({path:process.env.QA_SCREENSHOTS+'/models-raw.png'});
 await dialog.getByText('Raw file & backups').click();
 // Easy is the default: tune against this machine, MTP and KV cache choices only.
 await page.evaluate(()=>localStorage.removeItem('noevia:model-settings-mode'));
 assert.equal(await dialog.getByRole('button',{name:'Easy',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await dialog.getByLabel('Context size').count(),0,'the full form shows in Easy mode');
 await dialog.getByRole('button',{name:'Tune for this machine'}).click();
 await dialog.getByText(/Recommended: 256K tokens on cowork-llama-1/).waitFor();
 // Why the recommendation is lower than memory allows, measured context on this machine, and MTP availability.
 await dialog.getByText(/Memory would allow 1024K; limited because prompt speed not measured yet/).waitFor();
 await dialog.getByText(/IQ3_XXS is below Q4/).waitFor();
 await dialog.getByText(/MTP layers built in/).waitFor();
 await dialog.getByText(/Saved: MTP \(engine defaults\) at 33.4 tokens\/s \(\+75% over off\), micro-batch 1024/).waitFor();
 assert.equal(await dialog.getByRole('progressbar').getAttribute('value'),'50','progress bar shows how far the run got');
 await dialog.getByText('4 of 8 tests').waitFor();
 assert.match(await dialog.getByRole('region',{name:'Auto-tune steps'}).innerText(),/measured earlier/,'reused measurements are labelled');
 await dialog.getByText(/Context can likely grow from 32,768 to about 63,720 tokens/).waitFor();
 assert.equal(await dialog.getByRole('region',{name:'Auto-tune steps'}).getByRole('row').count(),5);
 await dialog.locator('.mm-easy-measure > summary').filter({hasText:'Measure context on this machine'}).waitFor();
 await dialog.getByLabel('KV cache quantisation').selectOption('q4_0');
 await dialog.getByLabel('Speculative decoding (MTP)').selectOption('ngram-simple');
 if(process.env.QA_SCREENSHOTS){
  for(const [w,theme] of [[1440,'light'],[1440,'dark'],[768,'light'],[768,'dark'],[375,'light'],[375,'dark']]){
   await page.setViewportSize({width:w,height:950});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
   await dialog.getByText(/Memory would allow/).scrollIntoViewIfNeeded();
   await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/models-easy-top-${w}-${theme}.png`});
   await dialog.getByRole('region',{name:'Auto-tune steps'}).scrollIntoViewIfNeeded();
   await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/models-autotune-${w}-${theme}.png`});
   await dialog.getByText(/Memory would allow/).scrollIntoViewIfNeeded();if(w===1440&&theme==='light')await dialog.locator('.mm-easy-measure > summary').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`easy overflow ${w}`);
   await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/models-easy-${w}-${theme}.png`});
  }
  await page.setViewportSize({width:1440,height:950});await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 }
 await dialog.getByRole('button',{name:'Advanced',exact:true}).click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('noevia:model-settings-mode')),'advanced');
 await dialog.getByLabel('Context size').waitFor();
 await dialog.getByText('Autoconfig: work out settings that fit this machine').click();
 await dialog.getByRole('button',{name:'Run autoconfig'}).click();
 await dialog.getByText(/recommended 256K tokens per chat/).waitFor();
 await dialog.getByRole('button',{name:/Long context/}).click();
 await page.waitForFunction(()=>true);
 assert.ok(await dialog.getByRole('button',{name:/Balanced/}).isDisabled());
 await dialog.getByLabel('Vision (image input)').uncheck();await dialog.getByText(/Vision off: the projector is not loaded/).waitFor();
 assert.ok(calls.some(c=>c.includes('/autoconfig')));
 await dialog.getByRole('button',{name:'Fill the form with these values'}).click();
 assert.equal(await dialog.getByLabel('Context size').inputValue(),'262144');
 await dialog.getByRole('button',{name:'Save settings'}).click();
 await dialog.getByText(/The settings file changed since you opened it/).waitFor();
 await dialog.getByRole('button',{name:'Reload latest'}).click();
 await dialog.getByRole('button',{name:'Fill the form with these values'}).click();
 await dialog.getByRole('button',{name:'Save settings'}).click();
 await dialog.getByText(/Qwen-9B is loaded, so the engine keeps the old settings/).waitFor();
 await dialog.getByRole('button',{name:'Apply now (unloads the model)'}).click();
 await dialog.getByText(/Saved and applied. Qwen-9B was unloaded/).waitFor();
 assert.deepEqual(reloads,[{unload:false},{unload:true}]);
 // Easy's one-step path saves the tuned values through the same revision-checked save.
 await dialog.getByRole('button',{name:'Easy',exact:true}).click();
 await dialog.getByRole('button',{name:'Tune for this machine'}).click();
 const putsBefore=saveAttempts;
 await dialog.getByRole('button',{name:'Use and save'}).click();
 await dialog.getByText(/Qwen-9B is loaded, so the engine keeps the old settings/).waitFor();
 assert.equal(saveAttempts,putsBefore+1);
 await dialog.getByRole('button',{name:'Advanced',exact:true}).click();
 // Download → Set up
 await discover();
 assert.equal(await dialog.getByTestId('download-target').innerText(),"Downloads go to /mnt/user/ai-models · 139.7 GB free. The engine reads this whole folder; other shares appear here once they are mounted inside it.");
 // Search results carry what the server judged: fit, size, parameters, publisher trust.
 await dialog.getByText(/9B · dense · Q4_K_M · 5.2 GB · vision · apache-2.0/).waitFor();
 const pills=dialog.locator('.mm-results .mm-pill');
 assert.deepEqual(await pills.allInnerTexts(),['Trusted publisher','Fits this server']);
 // Filters: widening shows what was hidden and why; the hub link is always available.
 await dialog.locator('.mm-filters > summary').click();
 assert.match(await dialog.getByText(/Trusted publishers only/).innerText(),/1 hidden/);
 await dialog.getByLabel(/Show models that do not fit/).check();
 await dialog.getByText('40.0 GB does not fit the 13.5 GB the GPU can hold').waitFor();
 await dialog.getByLabel('Architecture').selectOption('moe');
 await dialog.getByLabel(/Vision only/).check();
 assert.match(searchQueries.at(-1),/moe=moe/);assert.match(searchQueries.at(-1),/vision=true/);
 assert.equal(await dialog.getByRole('link',{name:/Open this search on Hugging Face/}).getAttribute('href'),'https://huggingface.co/models?filter=gguf&search=x&sort=trending');
 await dialog.getByRole('button',{name:'Clear filters'}).click();
 if(process.env.QA_SCREENSHOTS){await dialog.locator('.mm-filters > summary').click();
  for(const [w,theme] of [[1440,'light'],[1440,'dark'],[768,'light'],[768,'dark'],[375,'light'],[375,'dark']]){
   await page.setViewportSize({width:w,height:950});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
   await dialog.locator('.mm-filters').scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`discover overflow ${w}`);
   await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/models-discover-${w}-${theme}.png`});}
  await page.setViewportSize({width:1440,height:950});await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  await dialog.locator('.mm-filters > summary').click();}
 await dialog.getByRole('button',{name:/synthetic\/model-GGUF/}).click();
 await dialog.getByRole('heading',{name:'synthetic/model-GGUF'}).waitFor();
 assert.ok(await dialog.getByText('Fast: 128K').isVisible());assert.ok(await dialog.getByText(/ships a vision projector/).isVisible());
 await dialog.getByLabel('Save to').selectOption('archive');
 assert.match(await dialog.getByTestId('download-target').innerText(),/\/mnt\/user\/ai-models\/archive/);
 await dialog.getByRole('button',{name:'Download',exact:true}).click();
 assert.equal(downloadBodies.at(-1).target,'archive');await dialog.getByText(/Queued model-Q4_K_M.gguf and 1 companion file/).waitFor();
 await dialog.getByRole('button',{name:'Set up this model'}).click();
 await dialog.getByRole('heading',{name:'new-model-Q4_K_M',level:3}).waitFor();assert.ok(await dialog.getByText('Defaults from the model file.').isVisible());

 // A finished download must reach the rest of the app WITHOUT remounting anything.
 // Both halves of the 2026-09-15 "downloaded models don't appear until later"
 // report are asserted here: the completion signal used to be dropped (Settings
 // never passed onModelsChanged), and every list fetched only on mount.
 extraJob={id:'j2',repo:'synthetic/other-GGUF',filename:'later-model/later-model-Q4_K_M.gguf',status:'downloading',error:null,bytes:2e9,downloaded:1e9,pct:50,speedH:'10 MB/s',etaH:'1m',parallel:true,chunks:[]};
 await discover();
 await dialog.getByText('later-model/later-model-Q4_K_M.gguf').waitFor();
 const installedBefore=calls.filter(c=>c==='GET /api/models/installed').length;
 // The engine now serves it, and the job reports done. Nothing is remounted:
 // the Download tab stays mounted and its own poller notices.
 extraRegistered=true;extraJob={...extraJob,status:'done',downloaded:2e9,pct:100};
 await dialog.getByTestId('download-setup-needed').waitFor();
 assert.match(await dialog.getByTestId('download-setup-needed').innerText(),/not yet (a model|models) the engine can serve/);
 // App's own model list refetched off the back of the completion — this is the
 // assertion the suite lacked, and it fails without the noevia:models-changed wiring.
 await page.waitForFunction(()=>true);
 await new Promise(r=>setTimeout(r,2500));
 assert.ok(calls.filter(c=>c==='GET /api/models/installed').length>installedBefore,
  'a completed download did not refresh the installed-model list');
 // Safe defaults: the completed model file registered itself and the preset reload ran
 // without unloading anything; the loaded model deferring it is said plainly.
 assert.ok(safeDefaults.includes('later-model-Q4_K_M'));
 assert.deepEqual(reloads.at(-1),{unload:false});
 await dialog.getByText(/Registered later-model-Q4_K_M with safe defaults \(8K context, MTP draft head\)\. Qwen-9B is loaded/).waitFor();if(process.env.QA_SCREENSHOTS)await page.screenshot({path:process.env.QA_SCREENSHOTS+'/models-safe-defaults.png'});
 // Files that appear in the models folder are set up automatically, once per session (2026-09-17,
 // user request); here the synthetic manager refuses, so the manual path stays and it is not retried.
 assert.equal(safeDefaults.filter(x=>x==='new-model-Q4_K_M').length,1);
 assert.match(await dialog.getByTestId('download-setup-needed').innerText(),/This file is downloaded but not yet a model/);
 assert.equal(await dialog.getByRole('button',{name:'Review settings'}).count(),1);

 // And the Library list picks it up in place, without being remounted.
 await yours();
 await dialog.getByRole('article',{name:'new-model-Q4_K_M'}).waitFor();
 const beforeInPlace=calls.filter(c=>c==='GET /api/models/installed').length;
 await page.evaluate(()=>window.dispatchEvent(new Event('noevia:models-changed')));
 await page.waitForFunction(n=>performance.now()>=0&&n===n,beforeInPlace);
 await new Promise(r=>setTimeout(r,500));
 assert.ok(calls.filter(c=>c==='GET /api/models/installed').length>beforeInPlace,
  'the Library tab did not refresh in place on noevia:models-changed');
 extraJob=null;extraRegistered=false;
 // Hardware
 await fold('Hardware');
 await dialog.getByText(/Unified memory: this GPU has a small dedicated area/).waitFor();
 assert.ok(await dialog.getByText('10.0 of 16.5 GiB').isVisible());assert.ok(await dialog.getByText('62%',{exact:true}).first().isVisible());
 assert.ok(await dialog.getByText(/Big-Model failed to load: The GPU ran out of memory/).isVisible());
 assert.ok(await dialog.locator('figure.viz-chart svg path.viz-line').count()>=6);
 const memChart=dialog.getByRole('figure',{name:/GPU memory of 16.5 GiB/});await memChart.locator('svg').hover({position:{x:200,y:60}});await memChart.locator('.viz-tip').waitFor();
 const hw=dialog.locator('details.mm-fold').filter({has:page.locator('> summary:has-text("Hardware")')}); assert.equal(await hw.getByText(/GPU may borrow/).count(),0,'no shared-memory warning with 14.5 of 29 GiB');
 await hw.getByText('Logs',{exact:true}).click();await hw.getByLabel('Filter',{exact:true}).fill('synthetic');await hw.getByRole('button',{name:'Refresh'}).click();await hw.getByText('matching synthetic line').waitFor();
 // Follow: polls while enabled, stays pinned to the newest line, pauses when scrolled up.
 await hw.getByLabel('Filter',{exact:true}).fill('');await hw.getByRole('button',{name:'Refresh'}).click();
 const log=hw.getByLabel('Engine log');await log.getByText(/line 5\d/).first().waitFor();
 await hw.getByLabel('Follow live').check();const before=logPolls;
 await new Promise(r=>setTimeout(r,4500));
 assert.ok(logPolls>=before+2,'follow did not poll');
 assert.ok(await log.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<24),'follow is not pinned to the newest line');
 await log.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
 await hw.getByText(/Paused while you read/).waitFor();
 await hw.getByRole('button',{name:/Jump to latest/}).click();await hw.getByText(/Following · updates every 2 s/).waitFor();
 await hw.getByLabel('Follow live').uncheck();
 await dialog.getByRole('button',{name:'Restart engine…'}).click();assert.ok(await dialog.getByText(/interrupts any chat in progress/).isVisible());await dialog.getByRole('button',{name:'Keep running'}).click();
 // Benchmarks
 await fold('Benchmarks');
 const bench=dialog.locator('details.mm-fold').filter({has:page.locator('> summary:has-text("Benchmarks")')});
 await bench.getByText('Prompt suite',{exact:true}).click();
 await bench.getByRole('checkbox',{name:'Qwen-9B',exact:true}).check();
 const start=bench.getByRole('button',{name:'Start benchmark'});assert.ok(await start.isDisabled());
 await bench.getByLabel(/I understand chat pauses/).check();await start.click();await bench.getByRole('alert').filter({hasText:/running|Could not start|already/i}).first().waitFor();
 assert.deepEqual(benchStarted.aliases,['Qwen-9B']);
 await bench.getByRole('button',{name:'View'}).click();await bench.getByRole('heading',{name:/Run 7/}).waitFor();
 assert.ok(await bench.getByRole('figure',{name:'Generation speed: Short answer'}).isVisible());
 await bench.getByText('Output',{exact:true}).click();await bench.getByText('OK, synthetic.').waitFor();
 await bench.getByRole('button',{name:'4 of 5'}).click();await bench.getByText('Coding 4/5').waitFor();
 // Prompts and routing
 await fold('Prompt library');
 const promptPanel=dialog.locator('details.mm-fold').filter({has:page.locator('> summary:has-text("Prompt library")')});
 await promptPanel.getByLabel('Name').fill('Synthetic prompt');await promptPanel.getByLabel('Prompt',{exact:true}).fill('Say hello.');await promptPanel.getByRole('button',{name:'Save prompt'}).click();await promptPanel.getByText('Synthetic prompt').waitFor();
 await dialog.getByRole('heading',{name:'Routing',exact:true}).waitFor();
 await dialog.getByText('How Auto decides',{exact:true}).click();
 assert.ok(await dialog.getByText(/Auto never blocks a message/).isVisible());
 assert.equal(await dialog.locator('label').filter({hasText:'Fast — quick answers'}).count(),1);
 assert.match(await dialog.getByRole('alert').filter({hasText:'no longer installed'}).innerText(),/Smart — harder questions \(Gemma-4-E4B-it-GGUF\)/);
 await dialog.getByText(/Per-project routing \(/).click();
 assert.ok(await dialog.getByText(/Change a project's model from its own model selector/).isVisible());
 // Layout at phone, tablet and desktop, both themes, on the densest tabs.
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  for(const name of ['Your models','Discover','Detail']){
   if(name==='Detail'){await yours();await openModel('Qwen-9B');}
   else await tab(name);
   await page.waitForTimeout(150);
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`overflow ${name} ${width} ${theme}`);
   const small=await dialog.evaluate(el=>[...el.querySelectorAll('.mm-root button, .mm-root select')].filter(b=>{const r=b.getBoundingClientRect();return r.width&&r.height&&r.height<40&&!b.classList.contains('mm-link')}).map(b=>b.textContent.trim()).slice(0,5));
   assert.deepEqual(small,[],`small targets ${name} ${width}`);
   await page.screenshot({path:`${shots}/noevia-models-${name.toLowerCase().replace(/ /g,'-')}-${width}-${theme}.png`,fullPage:false});
  }
 }
 await tab('Discover');
 // A broad one-word query under the trusted default: the panel must not simply be empty.
 // It says what happened AND offers the way out, without hunting for the filter that did it.
 await dialog.getByLabel('Search models').fill('gemma');
 await dialog.getByText(/30 hidden as untrusted publishers/).waitFor();
 const widen=dialog.getByRole('button',{name:'Show all publishers (30)'});
 await widen.waitFor();
 if(process.env.QA_SCREENSHOTS){await widen.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/models-discover-empty-1440-light.png`});}
 await widen.click();
 await dialog.getByText(/fanclub\/gemma-tune-GGUF/).waitFor();
 assert.match(searchQueries.at(-1),/trustedOnly=false/);
 assert.equal(await dialog.getByRole('button',{name:'Show all publishers (30)'}).count(),0,'the way out is gone once taken');
 if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/models-discover-widened-1440-light.png`});

 // Back returns to the Settings summary, not to the chat.
 await page.setViewportSize({width:1440,height:950});
 await dialog.getByRole('button',{name:'Settings',exact:true}).first().click();
 await page.getByRole('region',{name:'Settings'}).getByRole('button',{name:'Open model manager'}).waitFor();
 if(process.env.QA_SCREENSHOTS)await page.screenshot({path:process.env.QA_SCREENSHOTS+'/models-summary.png'});
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);
 console.log('PASS models settings: Settings summary opens the full-page manager and back: unified page with Your models/Discover, search judged for this server (fit/trust badges, filters, hub link), library details/delete, per-model detail autoconfig presets/vision/fill, revision conflict and apply-now reload, download search/estimates/queue/set up, hardware unified memory/tiles/charts/tooltip/diagnosis/logs/restart guard, benchmark confirm/run charts/output/rating, prompts, routing section, phone/tablet/desktop light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
