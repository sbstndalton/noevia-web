// Batch G (#226 #232 #239) visual check against the synthetic fixture: Settings for a member
// and for an admin, the Archived chats view, and the home composer at phone and desktop widths.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-shots';
(async()=>{
 const fixture=createFixture(31391);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 const chat=(id,extra={})=>({id,title:`Synthetic chat ${id}`,updatedAt:Date.UTC(2026,8,20+(id.length%3)),pinned:false,messages:[],...extra});
 for(const [w,h] of [[375,812],[1440,900]])for(const theme of ['light','dark'])for(const role of ['member','admin']){
  const page=await browser.newPage({viewport:{width:w,height:h},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  const user={id:'synthetic-user',username:'fixture',displayName:'Synthetic QA',role,diaryEnabled:true,onboarded:true};
  await page.route(/\/api\/(auth\/session|profile)$/,r=>r.fulfill({json:{user,passkeys:[]}}));
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{id:'p1',name:'Synthetic project',updatedAt:1000,files:[],chats:[chat('pa'),chat('pb',{archived:true,title:'Archived in project'})]}],freeChats:[chat('a'),chat('bb'),chat('ccc',{archived:true,title:'Old archived note'})]}}));
  const tag=`${w}-${theme}-${role}`;
  await page.goto('http://localhost:31391');await page.getByPlaceholder('Message noevia…').waitFor();
  if(role==='member'){await page.screenshot({path:`${out}/home-${w}-${theme}.png`});
   assert.ok(await page.locator('.home-recents').count()>0,`${tag}: home shows recents`);}
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,ctrlKey:true,bubbles:true})));
  let settings=page.getByRole('navigation',{name:'Settings categories'});
  if(!await settings.isVisible().catch(()=>false)){
   if(w<600)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
   await page.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('menuitem',{name:'Settings',exact:true}).click();
  }
  await settings.waitFor();
  // The admin group only renders once the profile fetch resolves and sets isAdmin
  // (SettingsShell.tsx); the nav container itself is visible a render earlier, so
  // check right after `waitFor()` can race that state update. Poll briefly instead
  // of trusting the first read.
  let admin=await page.locator('.settings-nav-admin').count();
  for(let attempt=0;attempt<10&&(admin>0)!==(role==='admin');attempt++){
   await page.waitForTimeout(30);
   admin=await page.locator('.settings-nav-admin').count();
  }
  assert.equal(admin>0,role==='admin',`${tag}: admin group only for admins`);
  await page.screenshot({path:`${out}/settings-${tag}.png`});
  await page.close();
 }
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{id:'p1',name:'Synthetic project',updatedAt:1000,files:[],chats:[chat('pb',{archived:true,title:'Archived in project'})]}],freeChats:[chat('a'),chat('ccc',{archived:true,title:'Old archived note'})]}}));
  await page.goto('http://localhost:31391');await page.getByPlaceholder('Message noevia…').waitFor();
  await page.getByRole('button',{name:'Archived chats'}).first().click();
  await page.getByText('Old archived note').first().waitFor();
  await page.screenshot({path:`${out}/archived-1440-${theme}.png`});
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('settings-split-shots: ok');
 }finally{await browser.close();await fixture.close?.();}
})().catch(e=>{console.error(e);process.exit(1);});
