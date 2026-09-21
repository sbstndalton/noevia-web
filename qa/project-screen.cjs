// Synthetic APIs only. The project screen of release 5: header actions, composer
// context chips, the outputs row, recent chats, and the context panel sections.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31277);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,theme] of [[1440,'light'],[390,'dark']]){
   const page=await browser.newPage({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   const project={id:'p-lab',name:'HomeLab',goal:'Keep the server boring.',instructions:'Answer in short steps.',memories:['Prefers concise answers'],
    files:[{name:'Research 2026-09-18 unraid-zfs-pools.md',content:'# Report'},{name:'Research 2026-09-18 unraid-zfs-pools.sources.json',content:'{}'},{name:'notes.md',content:'hello'}],
    assets:[],sourceFolders:['Documents/HomeLab','Documents/Manuals'],projectFolder:'Documents/HomeLab',toolboxes:['core'],modes:['chat'],
    chats:[{id:'c1',title:'ZFS pool layout',preview:'Two mirrors is the safer shape',updatedAt:Date.now()-3600000},
           {id:'c2',title:'UPS shutdown script',preview:'',updatedAt:Date.now()-86400000}],
    createdAt:1000,updatedAt:1000};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[project],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   await page.route('**/api/projects/*/sources/sync',r=>r.fulfill({json:{updated:[],skipped:[]}}));
   await page.goto('http://localhost:31277');await page.getByPlaceholder('Message noevia…').waitFor();
   await navClick(page,'Projects');
   await page.locator('.project-card').filter({hasText:'HomeLab'}).first().click();
   await page.getByRole('heading',{name:'HomeLab',level:1}).waitFor();

   // Header carries its actions, not just a title.
   await page.locator('.project-head-actions').getByRole('button',{name:'New chat'}).waitFor();
   await page.locator('.project-head-actions').getByRole('button',{name:'Project settings'}).waitFor();

   // Outputs: the report, not its sources sidecar, and not the uploaded note.
   const outputs=page.locator('.output-row li');
   assert.equal(await outputs.count(),1,'only the research report is an output');
   await page.locator('.output-card').getByText('unraid-zfs-pools').waitFor();
   await page.locator('.output-row').getByRole('link',{name:'Sources'}).waitFor();
   await page.getByRole('heading',{name:'Recent chats'}).waitFor();
   await page.locator('.chat-index-title').getByText('ZFS pool layout').waitFor();

   // Context chips state what rides along, and open what they count.
   const chips=page.locator('.composer-context-chips .chip');
   assert.deepEqual(await chips.allInnerTexts(),['Instructions','Memory · 1','Sources · 3','Linked folders · 1']);
   if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/project-screen-${width}-${theme}.png`});
   await chips.nth(2).click();
   await page.locator('.project-sources').waitFor();
   await page.getByRole('tab',{name:/^Chats/}).click();

   if(width>=1024){
    // Context panel sections, with Scheduled listed as not yet available.
    const rail=page.locator('.project-rail');
    await rail.getByRole('button',{name:/^Context/}).click();
    await rail.locator('.rail-context').getByText('Toolboxes').waitFor();
    await rail.locator('.rail-context').getByText('Documents/HomeLab').waitFor();
    assert.match(await rail.locator('.rail-row-btn.is-unavailable').innerText(),/Scheduled[\s\S]*Not yet available/);
    if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/project-screen-context-${width}-${theme}.png`});
   }
   // Nothing overflows sideways at either width.
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'the project page scrolls sideways');
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS project screen: header actions, outputs row (report only, with its sources link), recent chats, context chips that open what they count, Context panel and Scheduled marked unavailable, 1440 light and 390 dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
