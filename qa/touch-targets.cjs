// Bug hunt (area f): primary controls on touch screens are at least 44px in both dimensions (WCAG 2.5.5
// enhanced / platform guidance). Synthetic APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31394);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 const measure=(page,sel)=>page.evaluate(sel=>[...document.querySelectorAll(sel)].filter(el=>{const b=el.getBoundingClientRect();return b.width&&b.height;}).map(el=>{const b=el.getBoundingClientRect();return {sel,label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,30),w:Math.round(b.width),h:Math.round(b.height)};}),sel);
 try{
  for(const [width,height,isMobile] of [[375,812,true],[768,1024,true]]){
   const page=await browser.newPage({viewport:{width,height},isMobile,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
   const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:1000,updatedAt:1000,modes:['chat']};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...base,id:'p1',name:'Touch project'}],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   await page.goto('http://localhost:31394');await page.getByPlaceholder('Message noevia…').waitFor();
   const found=[...await measure(page,'.composer-add, .send-btn, .chat-header .icon-btn')];
   await navClick(page,'Projects');await page.locator('.project-card').first().waitFor();
   found.push(...await measure(page,'.project-card-options, .projects-search'));
   await page.locator('.project-card').first().click();await page.getByRole('tab',{name:/Chats/}).waitFor();
   found.push(...await measure(page,'.project-tabs [role=tab], .composer-add, .project-newchat, [aria-label="Thinking effort"]'));
   // A reload returns to where you were, so recovering by reloading lands back on the
   // project rather than on a chat; go through the account menu instead.
   await page.getByTitle('Settings',{exact:true}).first().click().catch(async()=>{
    // The account menu lives in the rail, which is a drawer at phone widths.
    const toggle=page.getByRole('button',{name:'Open navigation',exact:true});
    if(await toggle.isVisible().catch(()=>false))await toggle.click();
    await page.locator('.account-trigger').click();
    await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();
   });
   const dialog=page.getByRole('region',{name:'Settings'});await dialog.waitFor();
   found.push(...await measure(page,'.settings-back, .settings-detail > header .shell-icon-button'));
   const small=found.filter(f=>f.w<44||f.h<44).map(f=>`${f.sel} "${f.label}" ${f.w}x${f.h}`);
   assert.ok(found.length>=7,`too few controls measured at ${width}: ${found.length}`);
   assert.deepEqual(small,[],`${width}px touch targets under 44px`);
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS touch targets: composer, project tabs/options and Settings back/close are at least 44x44 on 375 and 768 touch screens.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
