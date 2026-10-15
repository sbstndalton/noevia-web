// #1814 (web#65 follow-ups): an empty successful "Refresh models" keeps the list and says so; a repeated
// throttle is announced again (the live region changes each press); every outcome note clears by itself.
// Synthetic APIs only. Fails before the change (list wiped, note never clears) and passes after it.
//   npm run build -- --outDir /tmp/noevia-qa-dist && QA_DIST=/tmp/noevia-qa-dist node qa/chatgpt-refresh-followups-1814.cjs
// Screenshots (2000 and 390, light and dark) go to $QA_SCREENSHOTS.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const PORT=31814;
const shots=process.env.QA_SCREENSHOTS||'/tmp/noevia-qa-1814';
(async()=>{
 fs.mkdirSync(shots,{recursive:true});
 const fixture=createFixture(PORT);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(const [width,theme] of [[2000,'light'],[2000,'dark'],[390,'light'],[390,'dark']]){
   const page=await browser.newPage(withLocale({viewport:{width,height:width<600?900:1100}}));const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   let mode='empty';
   await page.route('**/api/**',route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,json=(b,status=200)=>route.fulfill({status,json:b});
    if(p==='/api/features')return json({flags:{previews:false,chatgptOAuth:true}});
    if(p==='/api/providers'&&req.method()==='GET')return json({providers:[{id:'default',label:'Local engine',baseUrl:'http://engine.fixture.invalid/v1',apiKeyMasked:null,isDefault:true,managed:true,shared:true},{id:'chatgpt-oauth',label:'ChatGPT',baseUrl:'https://chatgpt.com/backend-api/codex',apiKeyMasked:null,isDefault:false,managed:false,shared:false,kind:'chatgpt-oauth',external:true,connection:'connected'}]});
    if(p==='/api/providers/chatgpt/models'){
     if(!u.searchParams.get('refresh'))return json({models:['gpt-synthetic-1','gpt-synthetic-mini'],cached:true,fetchedAt:1});
     if(mode==='empty')return json({models:[],cached:false,fetchedAt:2,throttled:false});
     return json({models:['gpt-synthetic-1','gpt-synthetic-mini'],cached:true,fetchedAt:2,throttled:true});
    }
    if(p.startsWith('/api/providers/chatgpt'))return json({state:'connected',account:{email:'s…@example.test',plan:'plus'},providerId:'chatgpt-oauth',external:true});
    return route.fallback();
   });
   const project={id:'p1',name:'Synthetic',model:'',routing:'manual',provider:'chatgpt-oauth',files:[],assets:[],toolboxes:['core']};
   await page.route('**/api/chats/*/context',r=>r.fulfill({json:{project}}));
   await page.route('**/api/models/installed',r=>r.fulfill({json:[]}));
   await page.route('**/api/auto-roles',r=>r.fulfill({json:{configured:false,roles:null}}));
   await page.route('**/api/models/capabilities',r=>r.fulfill({json:{modelManagement:false}}));
   await page.goto(`http://localhost:${PORT}`);
   await page.getByRole('button',{name:'Choose model'}).click();
   const dialog=page.getByRole('dialog',{name:'Model'});await dialog.waitFor();
   await dialog.getByRole('button',{name:/gpt-synthetic-mini/}).waitFor();
   const btn=dialog.getByRole('button',{name:'Refresh models',exact:true});await btn.waitFor();
   // 1. An empty answer keeps the list and says so.
   await btn.click();
   await dialog.getByText('No models returned. Kept the previous list').waitFor();
   await dialog.getByRole('button',{name:/gpt-synthetic-mini/}).waitFor();
   await page.screenshot({path:`${shots}/refresh-empty-${width}-${theme}.png`});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll at '+width);
   // 2. The note clears by itself.
   await dialog.getByText('No models returned. Kept the previous list').waitFor({state:'detached',timeout:8000});
   // 3. A repeated throttle changes the live region every press, and then clears.
   mode='throttled';
   const hint=dialog.locator('.mp-hint[role="status"]');
   await hint.evaluate(el=>{window.__texts=[];new MutationObserver(()=>window.__texts.push(el.textContent)).observe(el,{childList:true,characterData:true,subtree:true});});
   await btn.click();await dialog.getByText('Try again in a few seconds').waitFor();
   await btn.click();await page.waitForFunction(()=>window.__texts.filter(t=>t==='Try again in a few seconds').length>=2||window.__texts.filter(t=>t==='').length>=1);
   await dialog.getByText('Try again in a few seconds').waitFor();
   const texts=await page.evaluate(()=>window.__texts);
   assert.ok(texts.filter(t=>t==='Try again in a few seconds').length>=2,'each throttle is announced: '+JSON.stringify(texts));
   await dialog.getByText('Try again in a few seconds').waitFor({state:'detached',timeout:8000});
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS #1814 refresh follow-ups. Shots in '+shots);
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
