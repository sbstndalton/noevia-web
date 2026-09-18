// D5: preview surfaces follow features.previews, and the admin Features page toggles it. Synthetic APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const fixture=createFixture(31341);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const errors=[];
 try{
  for(const [width,height] of [[375,812],[768,1024],[1440,900]])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:width<768});
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   let previews=false;const saved=[];
   await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews}}}));
   await page.route('**/api/profile',r=>r.fulfill({json:{user:{id:'qa-admin',username:'admin',displayName:'Synthetic admin',role:'admin',diaryEnabled:true,onboarded:true},passkeys:[],sessions:[]}}));
   await page.route('**/api/admin/features',r=>r.fulfill({json:{features:[
     {name:'previews',label:'Preview surfaces',description:'Show the unbuilt Scheduled, Plugins, Explore and Code previews.',enabled:previews,source:'default',locked:false,env:'NOEVIA_FEATURE_PREVIEWS'},
     {name:'kiwix',label:'Offline Wikipedia',description:'A read-only lookup tool backed by an internal kiwix-serve.',enabled:true,source:'env',locked:true,env:'NOEVIA_FEATURE_KIWIX'},
     {name:'diaryMcpWrite',label:'Diary append tool',description:'Offer an approval-gated, append-only Diary tool through the in-app MCP server.',enabled:true,source:'admin',locked:false,env:'NOEVIA_FEATURE_DIARY_MCP_WRITE',pendingRestart:true}]}}));
   await page.route('**/api/admin/features/*',async r=>{const body=r.request().postDataJSON();saved.push(body);previews=body.enabled;
     return r.fulfill({json:{name:'previews',label:'Preview surfaces',description:'Show the unbuilt Scheduled, Plugins, Explore and Code previews.',enabled:previews,source:'admin',locked:false,env:'NOEVIA_FEATURE_PREVIEWS'}});});
   await page.goto('http://localhost:31341');
   await page.getByPlaceholder('Message noevia…').waitFor();
   assert.equal(await page.locator('.app-mode-switch').count(),0,`Code switch hidden by default ${width}`);
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('region',{name:'Settings'});await settings.waitFor();
   await settings.getByRole('button',{name:'Features',exact:true}).click();
   const toggle=settings.getByRole('switch',{name:'Preview surfaces'});await toggle.waitFor();
   assert.equal(await toggle.isChecked(),false);
   assert.equal(await settings.getByRole('switch',{name:'Offline Wikipedia'}).isDisabled(),true,'env-locked feature cannot be toggled');
   assert.ok(await settings.getByText('Set by the operator (NOEVIA_FEATURE_KIWIX).').isVisible());
   assert.ok(await settings.getByText('Saved. Restart the server to apply this change.').isVisible(),'restart-wired change says it is pending');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   if(shots)await page.screenshot({path:`${shots}/features-${width}-${theme}.png`});
   await toggle.click();
   await page.waitForFunction(()=>document.querySelector('[role=switch][aria-labelledby=feature-previews]')?.checked===true);
   assert.deepEqual(saved,[{enabled:true}]);
   {const close=settings.getByRole('button',{name:'Close settings'});await (await close.isVisible()?close:settings.getByRole('button',{name:'Back to app'})).click();} // phones hide the detail bar (0d269fa)
   await page.locator('.app-mode-switch').first().waitFor({state:'attached'});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS features: Code switch hidden until previews on; admin Features page toggles it, env-locked rows disabled; 375/768/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
