// Synthetic APIs only. Per-mode project enablement in the sidebar, Projects page,
// project page and the project settings dialog.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31259);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,theme] of [[375,'dark'],[1440,'light']]){
   const page=await browser.newPage({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:1000,updatedAt:1000};
   const projects=[{...base,id:'p-chat',name:'Random questions',modes:['chat']},{...base,id:'p-code',name:'C++ practice',modes:['code']},{...base,id:'p-all',name:'HomeLab',modes:['chat','cowork','code']}];
   const patches=[];
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects,freeChats:[]}}));
   await page.route('**/api/projects/*/config',async r=>{const body=r.request().postDataJSON();patches.push(body);const p=projects.find(x=>r.request().url().includes(x.id));Object.assign(p,body);await r.fulfill({json:{project:p}});});
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   await page.goto('http://localhost:31259');await page.getByPlaceholder('Message noevia…').waitFor();
   // Chat sidebar: only Chat-enabled projects.
   if(width<520){await page.getByRole('button',{name:'Open navigation',exact:true}).click();}
   const side=page.locator('.sidebar');
   await side.getByRole('button',{name:'Open Random questions',exact:true}).waitFor();
   assert.equal(await side.getByRole('button',{name:'Open HomeLab',exact:true}).count(),1);
   assert.equal(await side.getByRole('button',{name:'Open C++ practice',exact:true}).count(),0,'code-only project listed in the chat sidebar');
   if(width<520)await page.keyboard.press('Escape');
   // Projects page: every project, with where it is available.
   await navClick(page,'Projects');
   await page.locator('.project-card').filter({hasText:'C++ practice'}).first().getByLabel('Available in code').waitFor();
   assert.ok(await page.locator('.project-card').filter({hasText:'HomeLab'}).first().getByLabel('Available in chat, cowork, code').isVisible());
   if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/project-modes-cards-${width}-${theme}.png`});
   // A code-only project explains why it cannot be messaged here.
   await page.locator('.project-card').filter({hasText:'C++ practice'}).first().click();
   await page.getByText(/not enabled for Chat/).waitFor();
   assert.equal(await page.getByRole('textbox',{name:'Message C++ practice'}).isVisible(),false);
   // Settings: enable Chat; at least one mode is required.
   await navClick(page,'Projects');
   await page.locator('.project-card').filter({hasText:'C++ practice'}).first().locator('.project-card-options').click();await page.getByRole('menuitem',{name:'Project settings'}).click();
   const dialog=page.getByRole('dialog',{name:'Edit C++ practice'});await dialog.waitFor();
   await dialog.getByRole('checkbox',{name:/Code/}).uncheck();
   assert.ok(await dialog.getByRole('button',{name:'Save',exact:true}).isDisabled(),'saving with no modes must be impossible');
   await dialog.getByText('Choose at least one mode.').waitFor();
   await dialog.getByRole('checkbox',{name:/Chat/}).check();await dialog.getByRole('checkbox',{name:/Code/}).check();
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog overflows');
   if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/project-modes-dialog-${width}-${theme}.png`});
   await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
   assert.deepEqual(patches.at(-1).modes,['chat','code']);
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS project modes: chat sidebar filter, all projects with availability chips, code-only notice, settings toggle with at-least-one guard, 375/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
