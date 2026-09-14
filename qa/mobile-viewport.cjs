// Synthetic APIs only. Exercise touch layouts and keyboard-sized visual viewports.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31331);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const errors=[];
 async function reachable(locator,height){
   await locator.scrollIntoViewIfNeeded();
   assert.ok(await locator.evaluate((el,h)=>{const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<h&&el.contains(document.elementFromPoint(x,y));},height),'Control must be reachable inside the visible viewport');
 }
 try {
 for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true});
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   await page.goto('http://localhost:31331');
   const composer=page.getByPlaceholder('Message noevia…');await composer.waitFor();await reachable(composer,height);
   await composer.fill('Synthetic draft retained while resizing');
   await page.getByRole('button',{name:'Choose model'}).click();
   const dialog=page.getByRole('dialog');await dialog.waitFor();
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'Model dialog must not overflow horizontally');
   await reachable(dialog.getByTitle('Close',{exact:true}),height);
   await dialog.getByTitle('Close',{exact:true}).click();
   await page.getByTitle('Settings',{exact:true}).click();
   await page.getByRole('dialog').waitFor();
   assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'Settings must not overflow horizontally');
   if(width<700){
     for(const section of ['profile','diary','providers','usage','planned','general']){
       await page.getByLabel('Settings category').selectOption(section);
       await reachable(page.getByRole('button',{name:'Close settings',exact:true}),height);
       assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),`Settings ${section} must fit`);
     }
   }
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Diary',exact:true}).click();
   const diary=page.locator('#diary-draft');await diary.waitFor();await reachable(diary,height);
   await diary.fill('Synthetic Diary draft');
   await page.getByRole('button',{name:'List',exact:true}).click();
   await reachable(diary,height);assert.equal(await diary.inputValue(),'Synthetic Diary draft');
   await page.getByRole('button',{name:'Calendar',exact:true}).click();
   await reachable(diary,height);assert.equal(await diary.inputValue(),'Synthetic Diary draft');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page must not overflow horizontally');
   await page.screenshot({path:`/tmp/noevia-mobile-${width}-${theme}.png`});
   await page.getByRole('button',{name:'Projects',exact:true}).click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Projects must fit');
   await page.getByRole('button',{name:'Code',exact:true}).click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Code must fit');
   await page.screenshot({path:`/tmp/noevia-mobile-code-${width}-${theme}.png`});
   await page.close();
 }
 const page=await browser.newPage({viewport:{width:375,height:667},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>{
   const v=new EventTarget();Object.assign(v,{height:667,width:375,scale:1,offsetTop:0,offsetLeft:0});
   Object.defineProperty(window,'visualViewport',{value:v});
 });
 await page.goto('http://localhost:31331');
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
 console.log('PASS mobile viewport: seven phone/landscape/tablet/desktop sizes, both themes, composer/dialog reachability, settings overflow, keyboard shrink/restore, draft retention, pinch zoom.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
