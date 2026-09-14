// Browser contract for native context calibration against synthetic APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31329);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let job=null,polls=0,started=null,cancelled=0;
 const steps=[{ctx:8192,kind:'load',status:'passed',seconds:14,minAvailableGib:18.2},{ctx:16384,kind:'load',status:'passed',seconds:15,minAvailableGib:17.9},{ctx:32768,kind:'load',status:'failed',reason:'The model failed to load at this size.',seconds:9,minAvailableGib:12.1}];
 await page.route('**/api/models/**',route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/models/capabilities')return route.fulfill({json:{kind:'llamacpp',admin:true,presets:true,download:true,runtimeOptions:false}});
  if(url.pathname==='/api/models/installed')return route.fulfill({json:[{name:'synthetic/new-model:Q4_K_M',labels:[],loaded:false,sizeGB:4,maxContext:131072,source:'cache',canDelete:true,status:'unloaded'}]});
  if(url.pathname==='/api/models/downloads')return route.fulfill({json:[{id:'synthetic/new-model:Q4_K_M',model:'synthetic/new-model:Q4_K_M',progress:1,status:'completed'}]});
  if(url.pathname==='/api/models/calibration/cancel'){cancelled++;job={...job,status:'cancelled',phase:'Cancelled',restored:true};return route.fulfill({status:202,json:job});}
  if(url.pathname==='/api/models/calibration'&&req.method()==='POST'){started=req.postDataJSON();job={id:'j1',model:started.model,mode:started.mode,status:'running',phase:'Loading at 8,192 tokens',steps:[{...steps[0],status:'running'}],memoryGuard:'active',memoryFloorGib:2};return route.fulfill({status:202,json:job});}
  if(url.pathname==='/api/models/calibration'){
   if(job?.status==='running'){polls++;job={...job,steps:steps.slice(0,Math.min(3,polls+1)),phase:'Loading at 24,576 tokens'};}
   return route.fulfill({json:{job,history:[]}});
  }
  if(url.pathname==='/api/models/preset')return route.fulfill({json:{model:'synthetic/new-model:Q4_K_M',revision:'r1',options:{},defaults:{},fields:['ctx-size','parallel']}});
  return route.fulfill({json:[]});
 });
 await page.goto('http://localhost:31329');await page.getByRole('button',{name:'Choose model'}).click();
 await page.getByRole('button',{name:'Download',exact:true}).click();
 await page.getByRole('button',{name:'Measure context'}).click();
 // Arrives on Manage with the profile open at the calibration section.
 await page.getByRole('heading',{name:'Measure context on this machine'}).waitFor();
 const startButton=page.getByRole('button',{name:'Start calibration'});
 assert.equal(await startButton.isEnabled(),false);
 await page.getByLabel(/Quick: load tests only/).check();
 await page.getByRole('checkbox',{name:/Chat pauses for everyone/}).check();
 await startButton.click();
 assert.deepEqual(started,{model:'synthetic/new-model:Q4_K_M',mode:'quick',confirmPause:true});
 await page.getByRole('region',{name:'Calibration steps'}).getByText('32,768').waitFor({timeout:15000});
 assert.ok(await page.getByText('The model failed to load at this size.').isVisible());
 assert.ok(await page.getByText('Lowest free memory 12.1 GiB').isVisible());
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`overflow ${width} ${theme}`);
  const cancel=page.getByRole('button',{name:'Cancel calibration'});
  const box=await cancel.boundingBox();assert.ok(box&&box.height>=44,`cancel target ${width}`);
  await page.screenshot({path:`/tmp/noevia-native-calibration-${width}-${theme}.png`});
 }
 await page.getByRole('button',{name:'Cancel calibration'}).click();
 await page.getByText('The original profile was restored.').waitFor();
 assert.equal(cancelled,1);
 assert.ok(await page.getByRole('button',{name:'Start calibration'}).isVisible());
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);
 console.log('PASS native calibration browser: download hand-off, confirmation gate, quick mode, live steps with reasons and memory, cancel/restore, 44px cancel, phone/tablet/desktop light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
