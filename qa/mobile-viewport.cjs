// Synthetic APIs only. Exercise touch layouts and keyboard-sized visual viewports.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31331);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const errors=[];
 async function addContext(page){
   await page.route('**/api/features',route=>route.fulfill({json:{flags:{previews:true}}}));
   await page.route('**/api/chats/*/context',route=>route.fulfill({json:{project:{id:'synthetic-mobile-context',name:'Synthetic mobile context',model:'Synthetic reasoning model with a long name',files:[],assets:[],toolboxes:['core']}}}));
 }
 async function reachable(locator,height){
   await locator.scrollIntoViewIfNeeded();
   assert.ok(await locator.evaluate((el,h)=>{const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<h&&el.contains(document.elementFromPoint(x,y));},height),'Control must be reachable inside the visible viewport');
 }
 try {
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[640,800],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true});
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   await addContext(page);await page.goto('http://localhost:31331');
   const composer=page.getByPlaceholder('Message noevia…');await composer.waitFor();await reachable(composer,height);
   await composer.fill('Synthetic draft retained while resizing');
   await page.getByRole('button',{name:'Choose model'}).click();
   const dialog=page.getByRole('dialog');await dialog.waitFor();
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'Model dialog must not overflow horizontally');
   await reachable(dialog.getByTitle('Close',{exact:true}),height);
   await dialog.getByTitle('Close',{exact:true}).click();
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('region',{name:'Settings'});await settings.waitFor();
   assert.ok(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth),'Settings must not overflow horizontally');
   if(width<700){
     // Phones show the list, then each page with a back arrow and a close button.
     for(const section of ['Account','Security and login','General','Personalization','Capabilities','Diary & storage','AI providers','Usage','Data controls','Planned features']){
       await settings.getByRole('button',{name:section,exact:true}).click();
       await reachable(settings.getByRole('button',{name:'Close settings'}),height);
       assert.ok(await settings.evaluate(el=>el.scrollWidth<=el.clientWidth),`Settings ${section} must fit`);
       await settings.getByRole('button',{name:'All settings'}).click();
     }
     await reachable(settings.getByRole('button',{name:'Back to app',exact:true}),height);
   }
   await page.keyboard.press('Escape');
   // Below 600px navigation lives in the drawer; everything else is in the sidebar.
   const nav=async()=>{if(width<=600){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('dialog',{name:'Navigation'}).waitFor();await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity));}}; // the drawer slides in
   await nav();
   // On a phone search is the field under the drawer's header (like Claude's); elsewhere a button.
   await reachable(width<=600?page.getByRole('textbox',{name:'Search projects and chats',exact:true}):page.getByRole('button',{name:'Search projects and chats',exact:true}).first(),height);
   if(width<=600)await page.keyboard.press('Escape');
   await nav();
   await page.getByRole('button',{name:'Diary',exact:true}).click();
   const diary=page.locator('#diary-draft');await diary.waitFor();await reachable(diary,height);
   await diary.fill('Synthetic Diary draft');
   await page.getByRole('button',{name:'List',exact:true}).click();
   await reachable(diary,height);assert.equal(await diary.inputValue(),'Synthetic Diary draft');
   await page.getByRole('button',{name:'Calendar',exact:true}).click();
   await reachable(diary,height);assert.equal(await diary.inputValue(),'Synthetic Diary draft');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page must not overflow horizontally');
   await page.screenshot({path:`/tmp/noevia-mobile-${width}-${theme}.png`});
   await nav();await page.getByRole('button',{name:'Projects',exact:true}).click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Projects must fit');
   await nav();await page.getByRole('button',{name:'Code',exact:true}).click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Code must fit');
   await page.screenshot({path:`/tmp/noevia-mobile-code-${width}-${theme}.png`});
   await page.close();
 }
 const page=await browser.newPage({viewport:{width:375,height:667},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>{
   const v=new EventTarget();Object.assign(v,{height:667,width:375,scale:1,offsetTop:0,offsetLeft:0});
   Object.defineProperty(window,'visualViewport',{value:v});
 });
 await addContext(page);await page.goto('http://localhost:31331');
 const composer=page.getByPlaceholder('Message noevia…');await composer.fill('Keyboard draft');
 await page.evaluate(()=>{visualViewport.height=360;visualViewport.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>document.documentElement.hasAttribute('data-short-viewport'));
 await reachable(composer,360);
 assert.equal(await composer.inputValue(),'Keyboard draft');
 await page.screenshot({path:'/tmp/noevia-mobile-visual-keyboard.png'});
 await page.evaluate(()=>{visualViewport.scale=2;visualViewport.height=180;visualViewport.dispatchEvent(new Event('resize'));});
 await page.waitForTimeout(50);
 assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--visible-viewport-height')),'360px');
 await page.evaluate(()=>{visualViewport.scale=1;visualViewport.height=667;visualViewport.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-short-viewport'));
 assert.equal(await composer.inputValue(),'Keyboard draft');await reachable(composer,667);
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);
 console.log('PASS mobile viewport: eight phone/landscape/tablet/desktop sizes, search reachable at each, both themes, composer/dialog reachability, settings overflow, keyboard shrink/restore, draft retention, pinch zoom.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
