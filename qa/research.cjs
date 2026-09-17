// D12: Research tab for admins with features.deepResearch. Synthetic APIs only; no model, no web.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const fixture=createFixture(31371);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,height] of [[375,812],[768,1024],[1440,900]])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:width<768});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:1000,updatedAt:1000,modes:['chat']};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...base,id:'p1',name:'Battery notes'}],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   let flags={deepResearch:false};
   await page.route('**/api/features',r=>r.fulfill({json:{flags}}));
   const budget={maxWebCalls:12,maxMs:600000,resultsPerQuery:5};
   const jobs=[];const posts=[];
   const job=(over)=>({id:'12345678-1234-4234-8234-123456789012',status:'running',stage:'Researching 2 of 3: How much energy does the Zephyr cell store per kilogram?',plan:{status:'edited',question:'Zephyr cell energy density',subQuestions:['What is the Zephyr cell?','How much energy does the Zephyr cell store per kilogram?','Who makes it?']},error:null,createdAt:1,updatedAt:2,checkpoint:{step:1,question:'What is the Zephyr cell?'},artifacts:[],result:null,canSavePartial:false,...over});
   await page.route('**/api/projects/p1/research**',async r=>{
     const url=new URL(r.request().url()),method=r.request().method();
     if(url.pathname.endsWith('/research/plan')){posts.push(['plan',r.request().postDataJSON()]);return r.fulfill({json:{subQuestions:['What is the Zephyr cell?','How much energy does it store?','Who makes it?']}});}
     if(url.pathname.endsWith('/cancel')){jobs[0]=job({status:'cancelled',stage:null,result:{question:'Zephyr cell energy density',partial:true,sections:1,questions:3,citationValidity:1,citations:2,webCalls:4,markdown:'# Zephyr cell energy density\n\n> Partial report: 1 of 3 questions were researched.\n\n## What is the Zephyr cell?\n\nThe Zephyr cell stores 410 Wh per kilogram [1].\n\n## Sources\n\n1. Zephyr — https://fixture.test/z (retrieved 2026-09-17)\n',sources:1},canSavePartial:true});return r.fulfill({json:jobs[0]});}
     if(url.pathname.endsWith('/save')){jobs[0]={...jobs[0],canSavePartial:false,artifacts:['Research 2026-09-17 zephyr-cell-energy-density.md','Research 2026-09-17 zephyr-cell-energy-density.sources.json']};return r.fulfill({json:jobs[0]});}
     if(method==='POST'){posts.push(['start',r.request().postDataJSON()]);jobs.unshift(job({}));return r.fulfill({status:202,json:jobs[0]});}
     return r.fulfill({json:{budget,available:true,reason:null,jobs}});
   });
   await page.goto('http://localhost:31371');await page.getByPlaceholder('Message noevia…').waitFor();
   await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Battery notes'}).first().click();
   await page.getByRole('tab',{name:/Chats/}).waitFor();
   assert.equal(await page.getByRole('tab',{name:'Research'}).count(),0,'Research tab shown with the feature off');
   flags={deepResearch:true};
   await page.evaluate(()=>window.dispatchEvent(new Event('noevia:features-changed')));
   await page.getByRole('tab',{name:'Research'}).click();
   const q=page.getByLabel('Research question');await q.fill('Zephyr cell energy density');
   await page.getByRole('button',{name:'Propose a plan'}).click();
   await page.getByLabel('Plan question 3').waitFor();
   await page.getByLabel('Plan question 2').fill('How much energy does the Zephyr cell store per kilogram?');
   await page.getByRole('button',{name:'Add question'}).click();
   await page.getByRole('button',{name:'Remove question 4'}).click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (plan)');
   if(shots)await page.screenshot({path:`${shots}/research-plan-${width}-${theme}.png`,fullPage:false});
   await page.getByRole('button',{name:'Start research'}).click();
   await page.getByText('Researching 2 of 3').waitFor();
   await page.getByRole('heading',{name:'Zephyr cell energy density'}).waitFor();
   assert.deepEqual(posts.at(-1),['start',{question:'Zephyr cell energy density',plan:'edited',subQuestions:['What is the Zephyr cell?','How much energy does the Zephyr cell store per kilogram?','Who makes it?']}]);
   assert.equal(await page.getByRole('button',{name:'Start without a plan'}).isDisabled(),true,'second job blocked while running');
   if(shots)await page.screenshot({path:`${shots}/research-running-${width}-${theme}.png`});
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   await page.getByRole('button',{name:'Save partial report'}).click();
   await page.getByText('Research 2026-09-17 zephyr-cell-energy-density.md').waitFor();
   await page.getByText('Report preview').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (report)');
   if(shots)await page.screenshot({path:`${shots}/research-saved-${width}-${theme}.png`,fullPage:true});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS research: tab hidden until feature, plan propose/edit/add/remove, start, progress, one job at a time, cancel, explicit partial save, report preview; 375/768/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
