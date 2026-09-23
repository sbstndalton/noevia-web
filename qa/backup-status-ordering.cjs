// Real settings UI, deferred synthetic APIs; no backup or Google request leaves localhost.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs');
const tick=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`,browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
 const admin={id:'admin',username:'admin',displayName:'Synthetic admin',role:'admin',disabled:false,diaryEnabled:true,onboarded:true};
 const status=snapshots=>({enabled:true,ready:true,reason:null,busy:null,schedule:'Nightly',retention:'Synthetic retention',destination:'Synthetic encrypted folder',paths:1,lastBackup:null,lastVerify:null,lastError:null,snapshots,google:{configured:true,state:'connected',email:'fixture@example.invalid'}});
 try{for(const scenario of ['old-last','old-error','during-post','google']){
  const page=await browser.newPage({viewport:{width:1440,height:950}});page.on('pageerror',e=>errors.push(e.message));
  let initial,older,second,gets=0,posts=0,failPost=false,failLoad=false;
  await page.route('**/api/**',r=>{const req=r.request(),path=new URL(req.url()).pathname;
   if(path==='/api/auth/session'||path==='/api/profile')return r.fulfill({json:{user:admin,passkeys:[]}});
   if(path==='/api/admin/offsite-backup'){
    if(++gets===1){initial=r;return;}if(gets===2){older=r;return;}
    return r.fulfill(failLoad?{status:500,json:{error:'Current status unavailable'}}:{json:status(22)});
   }
   if(path.startsWith('/api/admin/offsite-backup/')&&req.method()==='POST'){
    if(++posts===2&&scenario==='during-post'){second=r;return;}
    return r.fulfill(failPost?{status:500,json:{error:'Backup action failed'}}:{json:{ok:true}});
   }return r.continue();
  });
  await page.goto(origin);await page.getByTitle('Settings',{exact:true}).click();const settings=page.getByRole('region',{name:'Settings',exact:true});
  await settings.getByRole('button',{name:'Backups',exact:true}).click();while(!initial)await tick(page);
  const button=name=>settings.getByRole('button',{name,exact:true});assert.equal(await button('Back up now').count(),0);await initial.fulfill({json:status(1)});
  const count=settings.locator('.set-row').filter({hasText:'Snapshots kept'}).locator('.set-row-value');
  await button(scenario==='google'?'Copy to Drive now':'Back up now').click();while(!older)await tick(page);await button('Test restore').click();
  if(scenario==='during-post'){while(!second)await tick(page);await older.fulfill({json:status(9)});await tick(page);assert.equal(await count.textContent(),'1');await second.fulfill({json:{ok:true}});}
  await count.filter({hasText:/^22$/}).waitFor();
  if(scenario!=='during-post'){await older.fulfill(scenario==='old-error'?{status:500,json:{error:'Obsolete status failure'}}:{json:status(9)});await tick(page);}
  assert.equal(await count.textContent(),'22');assert.equal(await settings.getByRole('alert').count(),0);
  failPost=true;failLoad=true;await button('Back up now').click();await settings.getByRole('alert').filter({hasText:'Current status unavailable'}).waitFor();assert.ok(await settings.getByRole('alert').filter({hasText:'Backup action failed'}).isVisible());
  failLoad=false;await button('Reload status').click();await button('Reload status').waitFor({state:'hidden'});assert.ok(await settings.getByRole('alert').filter({hasText:'Backup action failed'}).isVisible());
  failPost=false;await button('Back up now').click();await button('Backing up…').waitFor({state:'hidden'});await tick(page);assert.equal(await settings.getByRole('alert').count(),0);
  if(scenario==='old-last'){
   failLoad=true;await button('Test restore').click();const retry=button('Reload status');await retry.waitFor();
   for(const theme of ['light','dark'])for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);await page.keyboard.press('Tab');await retry.focus();await page.waitForTimeout(150);
    assert.ok(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await retry.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'));
    await page.screenshot({path:`/tmp/noevia-backup-status-${width}-${theme}.png`});
   }
  }await page.close();
 }assert.deepEqual(errors,[]);console.log('PASS backup/Google refresh ordering, stale errors, action invalidation, retry/error separation, initial gate, responsive themes/focus.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
