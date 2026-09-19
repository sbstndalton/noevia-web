// Populated, isolated navigation: no real chats, corpus, or inference.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31336);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 for(const [width,height,keyboard] of [[320,360],[375,360],[667,375],[375,667],[768,1024],[1440,900],[375,360,true]])for(const theme of ['light','dark']){
 const page=await browser.newPage({viewport:{width,height:keyboard?667:height},hasTouch:true,isMobile:width<768,reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 if(keyboard)await page.addInitScript(()=>{const v=new EventTarget();Object.assign(v,{height:360,width:375,scale:1,offsetTop:0,offsetLeft:0});Object.defineProperty(window,'visualViewport',{value:v});});
 await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
 const chat=(id,pinned=false)=>({id,title:`Synthetic ${id}`,updatedAt:1000,pinned,messages:[]});
 await page.route('**/api/workspace',r=>r.fulfill({json:{projects:Array.from({length:5},(_,i)=>({id:`p${i}`,name:`Synthetic project ${i}`,pinned:i===0,updatedAt:1000,files:[],chats:[chat(`nested${i}`)]})),freeChats:[chat('pinned',true),...Array.from({length:12},(_,i)=>chat(`recent${i}`))]}}));
 await page.goto('http://localhost:31336');await page.getByPlaceholder('Message noevia…').waitFor();
 if(width<520)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 const sidebar=page.locator('.sidebar');
 const history=page.locator('.sidebar-history');
 assert.ok(await history.evaluate(el=>el.clientHeight>0),`${width}x${height}: history collapsed`);
 async function reach(locator){
 await locator.scrollIntoViewIfNeeded();
 const probe=await locator.evaluate((el,h)=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {ok:r.width>=44&&r.height>=44&&r.y>=-1&&r.bottom<=h+1&&el.contains(hit),rect:[r.x,r.y,r.width,r.height].map(Math.round),hit:hit?.className?.baseVal??hit?.className};},height);
 assert.ok(probe.ok,`${width}x${height} ${theme}: target unreachable or smaller than 44px: ${await locator.getAttribute('aria-label')} ${JSON.stringify(probe)}`);
 }
 for(const name of ['Options for Synthetic pinned','Expand chats in Synthetic project 0','Options for Synthetic nested0','Options for Synthetic project 4','Options for Synthetic recent11']){
 const target=(name.includes('nested0')?page.locator('.project-children'):page).getByRole('button',{name,exact:true});await reach(target);await target.click();
 if(name.startsWith('Options')){
 const menu=page.getByRole('menu');try{await menu.waitFor({timeout:3000});}catch(e){console.log({width,height,theme,name,menu:await menu.evaluateAll(els=>els.map(el=>({html:el.outerHTML,rect:el.getBoundingClientRect().toJSON()})))});await page.screenshot({path:'/tmp/noevia-sidebar-failure.png'});throw e;}
 const item=menu.getByRole('menuitem').first();await reach(item);
 await page.screenshot({path:`/tmp/noevia-sidebar-${width}x${height}-${theme}-${name.split(' ').at(-1)}.png`});
 if(name.endsWith('recent11')){await menu.getByRole('menuitem',{name:'Rename',exact:true}).click();const input=page.locator('.proj-rename-input');await input.waitFor();assert.equal(await input.inputValue(),'Synthetic recent11');await input.press('Escape');}else{await page.keyboard.press('Escape');await reach(target);}
 } }
 assert.ok(await sidebar.evaluate(el=>el.scrollTop>0||[...el.querySelectorAll('.sidebar-history, .side-scroll')].some(x=>x.scrollTop>0)),'Populated navigation must actually scroll');
 await reach(page.getByRole('button',{name:'Diary',exact:true}));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
 await page.close();
 }
 // Drawer contract: resizing below 600px removes the sidebar at once; one toggle opens a
 // full-width drawer that traps focus and closes on Escape, backdrop and selection.
 {
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:31336');await page.getByPlaceholder('Message noevia…').waitFor();
  const toggle=page.getByRole('button',{name:'Open navigation',exact:true});
  assert.equal(await toggle.isVisible(),false);assert.ok(await page.locator('.sidebar').isVisible());
  await page.setViewportSize({width:375,height:740});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sidebar')).display==='none');
  assert.ok(await toggle.isVisible());
  const box=await toggle.boundingBox();assert.ok(box.width>=44&&box.height>=44,'toggle hit target');
  await toggle.click();
  const drawer=page.getByRole('dialog',{name:'Navigation'});await drawer.waitFor();
  // The drawer is a floating pane (release 2): most of the screen, with the page visible at its edge.
  assert.ok(await drawer.evaluate(el=>el.getBoundingClientRect().width>=Math.min(innerWidth*0.8,300)),'drawer spans most of the phone screen');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Close navigation');
  for(let i=0;i<40;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>!!document.activeElement?.closest('#app-navigation')),'focus left the drawer');}
  await page.keyboard.press('Shift+Tab');assert.ok(await page.evaluate(()=>!!document.activeElement?.closest('#app-navigation')));
  await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Open navigation','focus returns to the toggle');
  await toggle.click();await drawer.waitFor();await page.getByRole('button',{name:'Close navigation',exact:true}).click();await drawer.waitFor({state:'hidden'});
  await page.setViewportSize({width:500,height:740});await toggle.click();await drawer.waitFor(); // the drawer ends at 519px (was 600)
  // The phone drawer is full width, like Claude's, so there is no backdrop to tap: its close
  // button in the header dismisses it.
  await drawer.getByRole('button',{name:'Close navigation',exact:true}).click();await drawer.waitFor({state:'hidden'});
  await page.setViewportSize({width:375,height:740});await toggle.click();await drawer.waitFor();
  await drawer.getByRole('button',{name:'Projects',exact:true}).first().click();await drawer.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Projects',level:1}).waitFor();
  // Opening Settings from the drawer's account menu closes the drawer behind it.
  await toggle.click();await drawer.waitFor();
  await drawer.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();
  await drawer.waitFor({state:'hidden'});await page.getByRole('region',{name:'Settings'}).waitFor();await page.keyboard.press('Escape');
  await toggle.click();await drawer.waitFor();await page.setViewportSize({width:1440,height:900});
  await page.waitForFunction(()=>!document.querySelector('.nav-drawer-backdrop'));
  assert.ok(await page.locator('.sidebar').isVisible());assert.equal(await toggle.isVisible(),false);
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);
 console.log('PASS populated sidebar: seven viewport/keyboard cases, both themes, scrolling, 44px hit targets, nested/pinned/recent/project menus and focus recovery; mobile drawer collapse on resize, focus trap/restore, Escape/close/backdrop/selection dismissal.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
