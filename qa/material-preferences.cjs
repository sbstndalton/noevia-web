// Dynamic theme family (was material) and accessibility preferences against synthetic APIs only.
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
   await page.route('**/api/account/instructions',r=>r.fulfill({json:{text:'',style:'default',updatedAt:null,maxChars:4000}}));
   {let useProjectMemories=true;await page.route('**/api/account/memory',r=>{if(r.request().method()==='PUT')useProjectMemories=!!r.request().postDataJSON().useProjectMemories;return r.fulfill({json:{memories:[],useProjectMemories,updatedAt:null,maxItems:50,maxItemChars:300}});});}
   await page.goto('http://localhost:31452');await page.getByPlaceholder('Message noevia…').waitFor();
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('region',{name:'Settings',exact:true});
   const material=settings.getByRole('radiogroup',{name:'Theme family'});
   const motion=settings.getByRole('radiogroup',{name:'Motion'});
   await material.waitFor();
   assert.deepEqual(await material.locator('.family-tile-name').allTextContents(),['Editorial','Contemporary','Glass']);
   for(const [name,value] of [['Glass','glass'],['Contemporary','contemporary'],['Editorial','editorial']]){
    await material.getByRole('radio',{name:new RegExp('^'+name)}).click();
    await page.waitForFunction(value=>document.documentElement.dataset.family===value,value);
    await page.waitForTimeout(100);
    const control=page.locator('.new-chat-btn');await control.hover();await page.waitForTimeout(40);
    const state=await page.evaluate(()=>({lens:document.documentElement.dataset.lens,active:!!document.querySelector('[data-glass-active]')}));
    assert.equal(state.lens,value==='glass'?'svg':undefined);
    assert.equal(state.active,value==='glass');
    await material.getByRole('radio',{name:new RegExp('^'+name)}).focus();await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>{const s=getComputedStyle(document.activeElement);return s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2;}),'visible keyboard focus');
    await settings.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name:'Memory',exact:true}).click();
    const toggle=settings.getByRole('switch',{name:'Use project memory',exact:true});await toggle.waitFor();
    for(const checked of [true,false]){
     if(await toggle.isChecked()!==checked)await toggle.click();await page.waitForFunction(([c])=>document.querySelector('[aria-label="Use project memory"]')?.checked===c,[checked]);await page.waitForTimeout(250);
     const contrast=await toggle.evaluate(e=>{
      const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
      const track=luminance(getComputedStyle(e).backgroundColor),knob=luminance(getComputedStyle(e,'::after').backgroundColor);
      return (Math.max(track,knob)+.05)/(Math.min(track,knob)+.05);
     });
     assert.ok(contrast>=3,`${name} ${theme} switch ${checked?'on':'off'} contrast ${contrast}`);
    }
    await settings.getByRole('button',{name:'Appearance & language',exact:true}).click();await material.waitFor();
   }
   await material.getByRole('radio',{name:/^Glass/}).click();
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
  console.log('PASS dynamic theme families, switch knob/track contrast at least 3:1, visible focus, no label refraction, app/OS reduced motion, reduced transparency and increased contrast; both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
