// Deterministic timer ticks and deferred local APIs through the real connector UI.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs');
const tick=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`,browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
 const tools=[{name:'read',label:'Read files',write:false,mode:'ask'},{name:'write',label:'Write files',write:true,mode:'ask'}];
 const drive=(state,mode='ask',code='OLD-CODE')=>({id:'gdrive',name:'Google Drive',configured:true,state,email:state==='connected'?'fixture@example.invalid':null,userCode:code,verificationUrl:'https://example.invalid/device',backup:null,tools:tools.map(t=>({...t,mode:t.write?'ask':mode}))});
 try{for(const scenario of ['cancel','stale-error','connect','policy']){
  const page=await browser.newPage({viewport:{width:1440,height:950}});page.on('pageerror',e=>errors.push(e.message));
  // Control only the existing three-second poll timer; no application function is replaced.
  await page.addInitScript(()=>{const set=window.setInterval,clear=window.clearInterval;window.setInterval=(fn,ms,...args)=>{if(ms===3000){window.qaPoll=fn;return -900;}return set(fn,ms,...args);};window.clearInterval=id=>{if(id===-900){window.qaPoll=null;return;}clear(id);};window.open=()=>null;});
  let gets=0,older,post,holdPost=true,failAction=false,current=drive('pending');
  await page.route('**/api/connectors**',r=>{const req=r.request(),path=new URL(req.url()).pathname;
   if(path==='/api/connectors'){if(++gets===2){older=r;return;}if(gets===3&&scenario==='policy')current=drive('connected');return r.fulfill({json:{connectors:[current]}});}
   if(holdPost){post=r;return;}
   if(failAction)return r.fulfill({status:500,json:{error:'Synthetic action failure'}});
   if(path.endsWith('/connect'))current=drive('pending','ask','NEW-CODE');
   else if(path.endsWith('/policy'))current=drive('connected',req.postDataJSON().mode);
   else current=drive('disconnected');
   return r.fulfill({json:current});
  });
  await page.goto(origin);await page.getByTitle('Settings',{exact:true}).click();const settings=page.getByRole('region',{name:'Settings',exact:true});
  await settings.getByRole('button',{name:'Connectors',exact:true}).click();await settings.getByRole('button',{name:'Google Drive',exact:true}).click();await page.waitForFunction(()=>typeof window.qaPoll==='function');
  await page.evaluate(()=>window.qaPoll());while(!older)await tick(page);
  if(scenario==='policy'){
   await page.evaluate(()=>window.qaPoll());await settings.getByRole('button',{name:'Disconnect',exact:true}).waitFor();
   await settings.getByRole('combobox',{name:/Read.only tools: set all to/}).selectOption('block');
  }else await settings.getByRole('button',{name:'Cancel',exact:true}).click();
  while(!post)await tick(page);assert.equal(await page.evaluate(()=>window.qaPoll),null,'polling pauses during mutation');
  current=scenario==='policy'?drive('connected','block'):drive('disconnected');holdPost=false;await post.fulfill({json:current});
  if(scenario==='policy')await settings.getByRole('combobox',{name:/Read.only tools: set all to/}).filter({visible:true}).waitFor();
  else await settings.getByRole('button',{name:'Connect Google Drive',exact:true}).waitFor();
  if(scenario==='connect'){await settings.getByRole('button',{name:'Connect Google Drive',exact:true}).click();await settings.getByLabel('Google sign-in code',{exact:true}).filter({hasText:'NEW-CODE'}).waitFor();}
  await older.fulfill(scenario==='stale-error'?{status:500,json:{error:'Obsolete poll failure'}}:{json:{connectors:[drive('pending')]}});await tick(page);
  if(scenario==='policy')assert.equal(await settings.getByRole('combobox',{name:/Read.only tools: set all to/}).inputValue(),'block');
  else if(scenario==='connect')assert.equal(await settings.getByLabel('Google sign-in code',{exact:true}).textContent(),'NEW-CODE');
  else assert.ok(await settings.getByRole('button',{name:'Connect Google Drive',exact:true}).isVisible());
  assert.equal(await settings.getByRole('alert').count(),0);
  if(scenario==='cancel'){
   failAction=true;await settings.getByRole('button',{name:'Connect Google Drive',exact:true}).click();await settings.getByRole('alert').filter({hasText:'Synthetic action failure'}).waitFor();
   failAction=false;await settings.getByRole('button',{name:'Connect Google Drive',exact:true}).click();await settings.getByLabel('Google sign-in code',{exact:true}).waitFor();assert.equal(await settings.getByRole('alert').count(),0);
   for(const theme of ['light','dark'])for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);await page.keyboard.press('Tab');const cancel=settings.getByRole('button',{name:'Cancel',exact:true});await cancel.focus();await page.waitForTimeout(100);
    assert.ok(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await cancel.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'));
    await page.screenshot({path:`/tmp/noevia-connector-${width}-${theme}.png`});
   }
  }
  await settings.getByRole('button',{name:'Connectors',exact:true}).last().click();await tick(page);assert.equal(await settings.getByRole('alert').count(),0);assert.equal(await page.evaluate(()=>window.qaPoll),null);await page.close();
 }
 const page=await browser.newPage();let fail=true;await page.route('**/api/connectors',r=>r.fulfill(fail?{status:500,json:{error:'Current load failed'}}:{json:{connectors:[drive('disconnected')]}}));await page.goto(origin);await page.getByTitle('Settings',{exact:true}).click();const settings=page.getByRole('region',{name:'Settings',exact:true});await settings.getByRole('button',{name:'Connectors',exact:true}).click();await settings.getByRole('alert').waitFor();fail=false;await settings.getByRole('button',{name:'Try again',exact:true}).click();await settings.getByRole('alert').waitFor({state:'hidden'});assert.ok(await settings.getByRole('button',{name:'Google Drive',exact:true}).isEnabled());await page.close();
 assert.deepEqual(errors,[]);console.log('PASS connector poll/cancel/connect/policy ordering, stale errors, failure recovery, timer lifecycle and responsive themes/focus.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
