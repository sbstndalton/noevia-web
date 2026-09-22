// Dynamic material and accessibility preferences against synthetic APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31452);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width:1440,height:950}});
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(theme=>localStorage.setItem('cowork-theme',theme),theme);
   await page.route('**/api/profile/appearance',r=>r.fulfill({json:{theme,light:'iris',dark:'iris'}}));
   await page.goto('http://localhost:31452');await page.getByPlaceholder('Message noevia…').waitFor();
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('region',{name:'Settings',exact:true});
   const material=settings.getByRole('radiogroup',{name:'Material'});
   const motion=settings.getByRole('radiogroup',{name:'Motion'});
   await material.waitFor();
   assert.deepEqual(await material.getByRole('radio').allTextContents(),['Soft','Liquid glass','Material 3']);
   for(const [name,value] of [['Liquid glass','liquid'],['Material 3','material'],['Soft','soft']]){
    await material.getByRole('radio',{name,exact:true}).click();
    await page.waitForFunction(value=>document.documentElement.dataset.material===value,value);
    await page.waitForTimeout(100);
    const control=page.locator('.new-chat-btn');await control.hover();await page.waitForTimeout(40);
    const state=await page.evaluate(()=>({lens:document.documentElement.dataset.lens,active:!!document.querySelector('[data-glass-active]')}));
    assert.equal(state.lens,value==='liquid'?'svg':undefined);
    assert.equal(state.active,value==='liquid');
    assert.equal(await material.locator('.glass-thumb').evaluate(e=>getComputedStyle(e).backdropFilter),'none','selected labels never refract');
    await material.getByRole('radio',{name,exact:true}).focus();await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>{const s=getComputedStyle(document.activeElement);return s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2;}),'visible keyboard focus');
   }
   await material.getByRole('radio',{name:'Liquid glass',exact:true}).click();
   await motion.getByRole('radio',{name:'Reduced',exact:true}).click();
   await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-lens'));
   await page.locator('.new-chat-btn').hover();await page.waitForTimeout(40);
   assert.equal(await page.locator('[data-glass-active]').count(),0);
   await motion.getByRole('radio',{name:'System',exact:true}).click();
   await page.waitForFunction(()=>document.documentElement.dataset.lens==='svg');
   for(const features of [[{name:'prefers-reduced-motion',value:'reduce'}],[{name:'prefers-reduced-transparency',value:'reduce'}],[{name:'prefers-contrast',value:'more'}]]){
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia',{features});
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-lens'));
    await page.locator('.new-chat-btn').hover();await page.waitForTimeout(40);
    assert.equal(await page.locator('[data-glass-active]').count(),0);
    if(features[0].name!=='prefers-reduced-motion'){
     const blurred=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).backdropFilter!=='none';}).map(e=>e.className));
     assert.deepEqual(blurred,[],features[0].name+' disables optical effects');
    }
    await cdp.send('Emulation.setEmulatedMedia',{features:[]});await cdp.detach();
   }
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS dynamic materials, visible focus, no label refraction, app/OS reduced motion, reduced transparency and increased contrast; both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
