// Browser contract for native context calibration against synthetic APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31329);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let job=null,polls=0,started=null,cancelled=0;
 const steps=[{ctx:8192,kind:'load',status:'passed',seconds:6,minAvailableGib:18.2},{ctx:65536,kind:'long',status:'passed',seconds:71,promptPerSecond:842,minAvailableGib:14.1},{ctx:98304,kind:'long',status:'failed',reason:'Filling this context would take about 214 s, over the 120 s limit.',seconds:9,minAvailableGib:12.1},{ctx:81920,kind:'long',status:'running',progress:37,etaSeconds:58}];
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/profile'||url.pathname==='/api/auth/session')return route.fulfill({json:{user:{id:'qa',username:'admin',displayName:'Synthetic admin',role:'admin',diaryEnabled:true,onboarded:true},passkeys:[]}});
  if(url.pathname==='/api/models/capabilities')return route.fulfill({json:{kind:'llamacpp',admin:true,presets:true,download:true,runtimeOptions:false}});
  if(url.pathname==='/api/models/installed')return route.fulfill({json:[{name:'synthetic/new-model:Q4_K_M',labels:[],loaded:false,sizeGB:4,maxContext:131072,source:'cache',canDelete:true,status:'unloaded'}]});
  if(url.pathname==='/api/models/downloads')return route.fulfill({json:[{id:'synthetic/new-model:Q4_K_M',model:'synthetic/new-model:Q4_K_M',progress:1,status:'completed'}]});
  if(url.pathname==='/api/models/calibration/cancel'){cancelled++;job={...job,status:'cancelled',phase:'Cancelled',restored:true};return route.fulfill({status:202,json:job});}
  if(url.pathname==='/api/models/calibration'&&req.method()==='POST'){started=req.postDataJSON();job={id:'j1',model:started.model,promptBudgetSeconds:started.promptBudgetSeconds,status:'running',phase:'Loading at 8,192 tokens',steps:[{...steps[0],status:'running'}],memoryGuard:'active',memoryFloorGib:2};return route.fulfill({status:202,json:job});}
  if(url.pathname==='/api/models/calibration'){
   if(job?.status==='running'){polls++;job={...job,steps:steps.slice(0,Math.min(4,polls+1)),phase:'Long-prompt test at 81,920 tokens'};}
   return route.fulfill({json:{job,history:[]}});
  }
  if(url.pathname==='/api/models/preset')return route.fulfill({json:{model:'synthetic/new-model:Q4_K_M',revision:'r1',options:{},defaults:{},fields:['ctx-size','parallel']}});
  if(url.pathname.startsWith('/api/model-manager/'))return route.fulfill({status:404,json:{error:'not configured'}});
  if(url.pathname==='/api/models/evidence')return route.fulfill({json:{model:'synthetic/new-model:Q4_K_M',tracked:true,identityHash:'h',categories:[{category:'context_capacity',state:'verified',value:{ctx:65536},at:1760000000000,suite:{name:'native-calibration',version:1},limitations:['prompt budget 120 s']},{category:'vision',state:'stale',value:null,at:1760000000000,suite:null,limitations:['1×1 image accepted; not an accuracy test']},{category:'mtp_acceptance',state:'unverified',value:null,at:null,suite:null,limitations:[]},{category:'throughput',state:'unavailable',value:null,at:null,suite:null,limitations:[]}]}});
  if(url.pathname.startsWith('/api/models/'))return route.fulfill({json:[]});
  return route.continue();
 });
 await page.goto('http://localhost:31329');
 // Calibration lives in the model manager page (Settings → Models & routing → Open model manager), under a model's details.
 await page.getByTitle('Settings',{exact:true}).click();
 await page.getByRole('button',{name:'Models & routing'}).click();
 await page.getByRole('button',{name:'Open model manager'}).click();
 await page.getByRole('article',{name:'synthetic/new-model:Q4_K_M'}).getByRole('button',{name:'Details'}).click();
 await page.getByRole('heading',{name:'Measure context on this machine'}).waitFor();
 const evidence=page.getByRole('region',{name:'Qualification evidence for synthetic/new-model:Q4_K_M'});
 await evidence.waitFor();
 assert.match(await evidence.innerText(),/Context capacity\s+Verified for this configuration · 65,536 tokens/);
 assert.match(await evidence.innerText(),/Image input\s+Stale — settings or files changed since/);
 assert.match(await evidence.innerText(),/MTP acceptance\s+Not measured yet/);
 const startButton=page.getByRole('button',{name:'Start calibration'});
 assert.equal(await startButton.isEnabled(),false);
 await page.getByLabel(/Longest acceptable wait/).selectOption('120');
 await page.getByRole('checkbox',{name:/Chat pauses for everyone/}).check();
 await startButton.click();
 assert.deepEqual(started,{model:'synthetic/new-model:Q4_K_M',promptBudgetSeconds:120,confirmPause:true});
 await page.getByText('Prompt 37% · about 58 s left').waitFor({timeout:15000});
 assert.ok(await page.getByText('Filling this context would take about 214 s, over the 120 s limit.').isVisible());
 assert.ok(await page.getByText(/Read the prompt at 842 tokens\/s/).isVisible());
 assert.ok(await page.getByText('Lowest free memory 12.1 GiB').isVisible());
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  assert.ok(await page.locator('.model-manager-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`overflow ${width} ${theme}`);
  const cancel=page.getByRole('button',{name:'Cancel calibration'});
  const box=await cancel.boundingBox();assert.ok(box&&box.height>=44,`cancel target ${width}`);
  await page.screenshot({path:`/tmp/noevia-native-calibration-${width}-${theme}.png`});
 }
 await page.getByRole('button',{name:'Cancel calibration'}).click();
 await page.getByText('The original profile was restored.').waitFor();
 assert.equal(cancelled,1);
 assert.ok(await page.getByRole('button',{name:'Start calibration'}).isVisible());
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);
 console.log('PASS native calibration browser: settings library hand-off, confirmation gate, time limit, live prompt progress and ETA, over-limit reasons, speed and memory, cancel/restore, 44px cancel, phone/tablet/desktop light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
