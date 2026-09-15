const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31241);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage();let populated=false,failed=false,externalReads=0;
  const files={'MEMORY.md':'Synthetic root memory','AI Memory/notes.md':'Synthetic durable memory','Raw Sources/reference.md':'Synthetic source'};
  await page.route('**/api/diary/**',async route=>{
   const url=new URL(route.request().url());const json=data=>route.fulfill({json:data});
   if(url.pathname.endsWith('/external-sources')){externalReads++;return route.fulfill({status:403,json:{error:'Forbidden'}});}
   if(url.pathname.endsWith('/source'))return failed?route.fulfill({status:503,json:{error:'Synthetic listing unavailable'}}):json({source:'synthetic',months:populated?[{id:'2026-09'},{id:'2026-08'}]:[]});
   // Entries are dated in the requested month so the calendar landing always shows them.
   if(url.pathname.endsWith('/today')){const month=url.searchParams.get('month');return json({todayLog:populated&&month?`# ${month}-01\nSynthetic entry\n# ${month}-02\nEarlier entry`:'',standingSections:{}});}
   if(url.pathname.endsWith('/files')){
    const path=url.searchParams.get('path')||'';
    return json({files:!populated?[]:path?Object.keys(files).filter(p=>p.startsWith(path+'/')).map(p=>({path:p,name:p.split('/').pop(),isDir:false})):[{path:'MEMORY.md',name:'MEMORY.md',isDir:false},...['AI Memory','Raw Sources'].map(p=>({path:p,name:p,isDir:true}))]});
   }
   if(url.pathname.endsWith('/file')){const path=route.request().postDataJSON().path;return json({path,content:files[path],version:'fixture'});}
   return route.continue();
  });
  const open=async()=>{await page.goto('http://localhost:31241');await page.getByRole('button',{name:'Diary',exact:true}).click();};
  await open();await page.getByPlaceholder('Write your first entry…').waitFor();
  assert.equal(await page.getByRole('heading',{name:'Past entries',exact:true}).count(),0);
  assert.equal(await page.locator('.diary-landing h1').count(),0);
  for(const populatedState of [false,true]){
   populated=populatedState;await open();
   // Since a6d15c3/5894266 the landing is the month calendar and memory files live in the context rail.
   const rail=page.locator('.diary-context'),entry=page.locator('.calendar-day[aria-label$=", has entries"]').first();
   if(populated){await entry.waitFor();
    await rail.getByRole('button',{name:'AI Memory',exact:true}).click();await rail.getByRole('button',{name:'notes.md',exact:true}).click();
    const workspace=page.getByRole('region',{name:'Markdown workspace'});await workspace.getByText('Synthetic durable memory',{exact:true}).first().waitFor();await workspace.getByRole('button',{name:'Back to Diary'}).click();
    const label=(await entry.getAttribute('aria-label')).replace(/, has entries$/,'');
    await entry.click();await page.getByRole('heading',{name:label,exact:true}).waitFor();await page.locator('.diary-home-link').click();
    await entry.waitFor();
   }else{await page.getByPlaceholder('Write your first entry…').waitFor();assert.equal(await entry.count(),0);}
   await page.waitForFunction(()=>!document.querySelector('#diary-draft').disabled);
   for(const theme of ['light','dark'])for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('#diary-draft').focus();await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none');
    if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/landing-${populated}-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
   }
  }
  failed=true;await open();await page.getByRole('alert').waitFor();assert.equal(await page.getByPlaceholder('Write your first entry…').count(),0);
  assert.equal(externalReads,0);console.log('PASS empty/populated/error Diary landing, memory file and recent day navigation, member privacy, both themes and 375/768/1440 layouts');
  await context.close();
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
