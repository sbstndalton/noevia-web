// A8/HIG: appearance follows the device by default, can be pinned, and System tracks live changes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const fixture=createFixture(31397);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const width of [375,1440]){
   const ctx=await browser.newContext({viewport:{width,height:900},colorScheme:'light',isMobile:width<768,hasTouch:width<768});
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   let saved=null;const puts=[];
   await page.route('**/api/profile/appearance',r=>{if(r.request().method()==='PUT'){saved=r.request().postDataJSON();puts.push(saved);return r.fulfill({json:saved});}return r.fulfill({json:saved});});
   await page.goto('http://localhost:31397');await page.getByPlaceholder('Message noevia…').waitFor();
   const mode=()=>page.evaluate(()=>[document.documentElement.dataset.theme,document.documentElement.dataset.themePreference]);
   assert.deepEqual(await mode(),['light','system'],'a new browser follows a light device');
   await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
   await page.getByTitle('Settings',{exact:true}).click();
   const d=page.getByRole('region',{name:'Settings'});await d.waitFor();
   await d.getByRole('button',{name:'Appearance',exact:true}).click();
   const system=d.getByRole('button',{name:'System'});await system.waitFor();
   assert.equal(await system.getAttribute('aria-pressed'),'true');
   if(shots)await page.screenshot({path:`${shots}/appearance-system-${width}.png`});
   await d.getByRole('button',{name:'Light',exact:true}).click();
   assert.deepEqual(await mode(),['light','light']);assert.equal(puts.at(-1).theme,'light');
   await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(200);
   assert.deepEqual(await mode(),['light','light'],'a pinned mode ignores the device');
   await system.click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
   assert.equal(puts.at(-1).theme,'system');
   await page.reload();await page.getByPlaceholder('Message noevia…').waitFor();
   assert.deepEqual(await mode(),['dark','system'],'System survives a reload before React');
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS appearance system: follows the device by default and live, pins Light/Dark, saves System, restores before paint; 375/1440.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
