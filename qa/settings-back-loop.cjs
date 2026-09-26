// #304/#305: Settings back/close no longer loops through Models & routing, a new chat starts on
// Auto, and the Settings back control only ever appears when there is a section to step back to.
// Synthetic fixture and APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const shots=process.env.QA_SHOTS||'/tmp/settingsnav-shots';
require('node:fs').mkdirSync(shots,{recursive:true});

(async()=>{
 const fixture=createFixture(31421);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage(withLocale({viewport:{width:1440,height:950}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   const json=(body,status=200)=>route.fulfill({status,json:body});
   if(p==='/api/profile'||p==='/api/auth/session')return json({user:{id:'qa',username:'admin',displayName:'Synthetic admin',role:'admin',diaryEnabled:true,onboarded:true},passkeys:[]});
   if(p==='/api/models/capabilities')return json({kind:'llamacpp',admin:true,presets:true,download:true,runtimeOptions:false,modelManagement:true});
   if(p==='/api/models/installed')return json([{name:'Qwen-9B',labels:[],loaded:true,sizeGB:5.6,maxContext:262144,source:'preset',canDelete:false,status:'loaded'}]);
   if(p==='/api/routing-default')return json({routing:'auto'});
   if(p==='/api/auto-roles')return json({configured:true,roles:{fast:'Qwen-9B',smart:'Qwen-9B'},missing:[]});
   if(p.startsWith('/api/model-manager/')){
    const r=p.slice('/api/model-manager/'.length);
    if(r==='models')return json({models:[{key:'q/Qwen-9B.gguf',name:'Qwen-9B.gguf',subdir:'q',bytes:5.6e9,size:'5.6 GB',modified:'2026-09-01',sharded:false,parts:1,projector:null,sections:['Qwen-9B'],modelId:'Qwen-9B',file:'q/Qwen-9B.gguf',shape:{arch:'qwen35',moe:false,experts:0,active:0,label:'dense'},loadedOn:['cowork-llama-1'],fit:[],badges:[]}],unregistered:[],revision:'r1'});
    if(r==='overview')return json({modelsDir:{path:'/models',hostPath:'/mnt/user/ai-models',exists:true,disk:{total:5e11,free:1.5e11,usedPct:70,totalH:'465.7 GB',freeH:'139.7 GB'}},models:1,sections:1,backends:[],activeDownloads:0,revision:'r1'});
    if(r==='backends')return json({backends:[]});
    if(r==='host')return json({current:null,history:[]});
    if(r==='models/updates')return json({status:{}});
    if(r==='prompts')return json({prompts:[]});
    if(r==='settings')return json({hasToken:false,tokenHint:''});
    if(r==='benchmark')return json({sections:[],sweepArgs:{},prompts:[],backends:[],maxTokensDefault:3072,maxTokensCeiling:8192,job:{run_id:0,status:'idle',backend:'',total:0,done:0,current:'',error:'',unit:'requests',lines:[],pct:0,elapsed:0,eta:0,active:false},runs:[],categories:[]});
    if(r==='downloads')return json({jobs:[]});
    return json({});
   }
   return route.continue();
  });
  await page.goto('http://localhost:31421');
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();

  // ── #304: Settings -> Models & routing -> back -> Settings -> close -> chat, 3 times, no loop.
  for(let i=0;i<3;i++){
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('region',{name:'Settings',exact:true});
   await settings.getByRole('button',{name:'Models & routing',exact:true}).click();
   await settings.getByRole('button',{name:'Open model manager'}).click();
   await settings.waitFor({state:'detached'});
   const manager=page.locator('.model-manager-page');await manager.waitFor();
   // The manager's own back returns to the Settings section it was opened from, once. Wait for
   // the section heading itself first (admin status resolves async): only once it is stable is
   // the region locator itself unambiguous.
   await manager.getByRole('button',{name:'Settings',exact:true}).click();
   await page.getByRole('heading',{name:'Models & routing',exact:true}).waitFor();
   const settingsAgain=page.getByRole('region',{name:'Settings',exact:true});
   await settingsAgain.getByRole('heading',{name:'Models & routing',exact:true}).waitFor();
   // Close (X) must land back in chat, not re-show Models & routing.
   await settingsAgain.getByRole('button',{name:'Close settings'}).click();
   await settingsAgain.waitFor({state:'detached'}).catch(()=>{});
   await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
   assert.equal(await page.locator('.model-manager-page').count(),0,`iteration ${i}: Models & routing must not reappear after close`);
   assert.equal(await page.getByRole('region',{name:'Settings',exact:true}).count(),0,`iteration ${i}: Settings must not reappear after close`);
  }
  console.log('PASS settings-back-loop: Models & routing -> back -> Settings -> close -> chat, 3 iterations, no loop (#304).');

  // ── #304 (HIGH, Opus review): reloading mid-detour must not turn the loop back on. Opening
  // Models & routing, then reloading without ever closing Settings, used to persist the detour
  // itself as "last place" — so the very first Settings close after the reload resolved right
  // back into it. Since #359 the reload shows the page its address names (/models), but the
  // detour is still never the return target: Settings' back then close lands in chat, and
  // the saved last place (used for a bare `/`) is still the chat underneath (persistedView).
  await page.getByTitle('Settings',{exact:true}).click();
  await page.getByRole('region',{name:'Settings',exact:true}).getByRole('button',{name:'Models & routing',exact:true}).click();
  await page.getByRole('region',{name:'Settings',exact:true}).getByRole('button',{name:'Open model manager'}).click();
  await page.locator('.model-manager-page').waitFor();
  assert.equal(new URL(page.url()).pathname,'/models','Models & routing has its own address (#359)');
  await page.reload();
  await page.locator('.model-manager-page').waitFor();
  await page.locator('.model-manager-page').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Models & routing',exact:true}).waitFor();
  const settingsAfterReload=page.getByRole('region',{name:'Settings',exact:true});
  await settingsAfterReload.getByRole('heading',{name:'Models & routing',exact:true}).waitFor();
  await settingsAfterReload.getByRole('button',{name:'Close settings'}).click();
  await settingsAfterReload.waitFor({state:'detached'}).catch(()=>{});
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  assert.equal(await page.locator('.model-manager-page').count(),0,'after a reload mid-detour, Settings close lands in chat, not Models & routing');
  await page.goto('http://localhost:31421/');
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  assert.equal(await page.locator('.model-manager-page').count(),0,'a bare / restores the chat underneath, not the detour');
  console.log('PASS settings-back-loop: a reload from mid-detour never makes the detour the return target (#304, #359).');

  // ── #304 (HIGH, defensive fallback): data written before this fix (or any other stale record)
  // can still hand back a detour view directly on restore. Force exactly that and confirm
  // Settings' own back/close still never loops — restoreNavState's fresh fallback.
  await page.evaluate(() => localStorage.setItem('noevia:last-view', JSON.stringify({ user: 'qa', view: { kind: 'models' }, settings: null })));
  // A bare / is where the saved place applies (#359: any other address names its own place).
  await page.goto('http://localhost:31421/');
  await page.locator('.model-manager-page').waitFor();
  for(let i=0;i<2;i++){
   await page.locator('.model-manager-page').getByRole('button',{name:'Settings',exact:true}).click();
   // Wait for the section heading first (admin status resolves async — see the #304 loop test
   // above): only once it is stable is the region locator itself unambiguous.
   await page.getByRole('heading',{name:'Models & routing',exact:true}).waitFor();
   const settingsFromStale=page.getByRole('region',{name:'Settings',exact:true});
   await settingsFromStale.getByRole('heading',{name:'Models & routing',exact:true}).waitFor();
   await settingsFromStale.getByRole('button',{name:'Close settings'}).click();
   await settingsFromStale.waitFor({state:'detached'}).catch(()=>{});
   await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
   assert.equal(await page.locator('.model-manager-page').count(),0,`stale-data iteration ${i}: must not re-show Models & routing`);
   if(i===0){
    // Reopen the same way a person would (composer -> model settings), so the second close is a
    // real repeat of the same scenario, not just an already-empty page.
    await page.getByTitle('Settings',{exact:true}).click();
    await page.getByRole('region',{name:'Settings',exact:true}).getByRole('button',{name:'Models & routing',exact:true}).click();
    await page.getByRole('region',{name:'Settings',exact:true}).getByRole('button',{name:'Open model manager'}).click();
    await page.locator('.model-manager-page').waitFor();
   }
  }
  console.log('PASS settings-back-loop: a stale last-place record naming a detour view resolves to a fresh chat, not a loop (#304).');

  // ── #305: a new chat starts on Auto, not whatever happens to be loaded. StatsBar is hidden
  // until the first reply on a blank chat (#239), so this reads the composer's own model pill.
  await page.getByRole('button',{name:'New chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  await page.locator('.composer-model').filter({hasText:'Auto'}).first().waitFor();
  console.log('PASS settings-back-loop: a new chat shows Auto, not the last loaded model (#305).');

  // ── #305: the Settings back control (top-left) is hidden at the root on desktop, visible in a
  // drilled-in section on a phone width, and X remains the only close everywhere. The old
  // "Back to app" duplicate of X is gone (#305); the mobile drill-in's back control is the
  // "All settings" chevron in the detail header, which already only ever appears there.
  await page.setViewportSize({width:1440,height:950});
  await page.getByTitle('Settings',{exact:true}).click();
  let settings=page.getByRole('region',{name:'Settings',exact:true});
  await settings.waitFor();
  assert.equal(await settings.getByRole('button',{name:'All settings',exact:true}).count(),0,'1440: no back control at the Settings root');
  await page.screenshot({path:`${shots}/settings-back-1440.png`});
  await settings.getByRole('button',{name:'Close settings'}).click();
  await settings.waitFor({state:'detached'});

  await page.setViewportSize({width:375,height:812});
  await page.getByTitle('Settings',{exact:true}).click();
  settings=page.getByRole('region',{name:'Settings',exact:true});
  await settings.waitFor();
  assert.equal(await settings.getByRole('button',{name:'All settings',exact:true}).count(),0,'375: no back control on the section list either');
  await settings.getByRole('button',{name:'Appearance & language',exact:true}).click();
  await settings.getByRole('heading',{name:'Appearance & language',exact:true}).waitFor();
  const back=settings.getByRole('button',{name:'All settings',exact:true});
  await back.waitFor();
  await page.screenshot({path:`${shots}/settings-back-375.png`});
  await back.click();
  await settings.getByRole('button',{name:'Appearance & language',exact:true}).waitFor();
  assert.equal(await settings.getByRole('button',{name:'All settings',exact:true}).count(),0,'375: back to the list hides the back control again');
  await settings.getByRole('button',{name:'Close settings'}).click();
  await settings.waitFor({state:'detached'});
  console.log('PASS settings-back-loop: the back control is hidden at the Settings root (1440) and visible only in a drilled-in section (375).');

  assert.deepEqual(errors,[]);
  console.log('PASS settings-back-loop: all scenarios.');
 }finally{await browser.close();await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
