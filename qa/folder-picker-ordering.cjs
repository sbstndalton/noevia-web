// Deferred synthetic storage responses through the real linked-folder UI.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs'),{navClick}=require('./nav.cjs');
const tick=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`,browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
 try{for(const order of ['old-first','old-last','old-error']){
  const page=await browser.newPage({viewport:{width:1440,height:950}});page.on('pageerror',e=>errors.push(e.message));
  const project={id:'folders',name:'Synthetic folders',goal:'',instructions:'',memories:[],files:[],chats:[],sourceFolders:[],createdAt:1,updatedAt:1};
  let older,current,rootCalls=0,created=false,picked;const dirs=names=>({entries:names.map(path=>({path,name:path.split('/').pop(),isDir:true}))});
  await page.route('**/api/**',r=>{const req=r.request(),p=new URL(req.url()).pathname;
   if(p==='/api/workspace')return r.fulfill({json:{projects:[project],freeChats:[]}});
   if(p==='/api/projects/folders/skills')return r.fulfill({json:{skills:[]}});
   if(p==='/api/projects/folders/config'){picked=req.postDataJSON().sourceFolders;project.sourceFolders=picked;return r.fulfill({json:project});}
   if(p==='/api/integrations/storage/files'){if(++rootCalls===2&&order==='old-first'){current=r;return;}return r.fulfill({json:dirs(['a','b'])});}
   if(p==='/api/integrations/storage/files/a'){older=r;return;}
   if(p==='/api/integrations/storage/files/b')return r.fulfill({json:dirs(created?['b/new']:['b/current'])});
   if(p==='/api/integrations/storage/folder'){assert.equal(req.postDataJSON().path,'b/new');created=true;return r.fulfill({json:{path:'b/new',existed:false}});}
   return r.continue();});
  await page.goto(origin);await navClick(page,'Projects');await page.getByText(project.name,{exact:true}).last().click();await page.getByRole('tab',{name:'Sources',exact:true}).click();
  await page.getByText('Linked reference folders (0)',{exact:true}).click();await page.getByRole('button',{name:'Link folder',exact:true}).click();const d=page.getByRole('dialog',{name:'Choose a folder',exact:true});
  await d.getByRole('button',{name:'📁 a',exact:true}).click();await d.getByRole('status').waitFor();assert.equal(await d.locator('.folder-open').count(),0);assert.ok(await d.getByRole('button',{name:'Link “a”',exact:true}).isDisabled());
  await d.getByRole('button',{name:'Up',exact:true}).click();while(!older)await tick(page);
  if(order==='old-first'){while(!current)await tick(page);await older.fulfill({json:dirs(['a/stale'])});await tick(page);assert.ok(await d.getByRole('status').isVisible());assert.equal(await d.locator('.folder-open').count(),0);await current.fulfill({json:dirs(['a','b'])});}
  await d.getByRole('button',{name:'📁 b',exact:true}).click();await d.getByRole('button',{name:'📁 current',exact:true}).waitFor();
  if(order!=='old-first'){await older.fulfill(order==='old-error'?{status:500,json:{error:'Obsolete failure'}}:{json:dirs(['a/stale'])});await tick(page);}
  assert.equal(await d.locator('header code').textContent(),'/b');assert.equal(await d.getByRole('alert').count(),0);assert.equal(await d.getByRole('button',{name:'📁 stale',exact:true}).count(),0);
  await d.getByRole('button',{name:'New folder',exact:true}).click();await d.getByPlaceholder('New folder name').fill('new');await d.getByRole('button',{name:'Create',exact:true}).click();await d.getByRole('button',{name:'📁 new',exact:true}).waitFor();
  if(order==='old-last')for(const theme of ['light','dark'])for(const width of [375,768,1440]){
   await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);await page.keyboard.press('Tab');const link=d.getByRole('button',{name:'Link “b”',exact:true});await link.focus();await page.waitForTimeout(100);
   assert.ok(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await link.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'));
   await page.screenshot({path:`/tmp/noevia-folder-picker-${width}-${theme}.png`});}
  await d.getByRole('button',{name:'Link “b”',exact:true}).click();while(!picked)await tick(page);assert.deepEqual(picked,['b']);await page.close();
 }assert.deepEqual(errors,[]);console.log('PASS folder ordering, stale errors/loading, creation reload, linked path and responsive themes/focus.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
