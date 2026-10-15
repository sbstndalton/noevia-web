// #1306 (web): an explicit "Refresh models" in the ChatGPT model picker calls GET /api/providers/chatgpt/models?refresh=1
// and says what happened. Never automatic. Synthetic APIs only. Fails before the change (no control) and passes after.
//   npm run build -- --outDir /tmp/noevia-qa-dist && QA_DIST=/tmp/noevia-qa-dist node qa/chatgpt-refresh-models-1306.cjs
// Screenshots (2000 and 390, light and dark) go to $QA_SCREENSHOTS.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const PORT=31306;
const shots=process.env.QA_SCREENSHOTS||'/tmp/noevia-qa-1306';
(async()=>{
 fs.mkdirSync(shots,{recursive:true});
 const fixture=createFixture(PORT);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(const [width,theme] of [[2000,'light'],[2000,'dark'],[390,'light'],[390,'dark']]){
   const page=await browser.newPage(withLocale({viewport:{width,height:width<600?900:1100}}));const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   const calls=[];let mode='ok';
   await page.route('**/api/**',route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,json=(b,status=200)=>route.fulfill({status,json:b});
    if(p==='/api/features')return json({flags:{previews:false,chatgptOAuth:true}});
    if(p==='/api/providers'&&req.method()==='GET')return json({providers:[{id:'default',label:'Local engine',baseUrl:'http://engine.fixture.invalid/v1',apiKeyMasked:null,isDefault:true,managed:true,shared:true},{id:'chatgpt-oauth',label:'ChatGPT',baseUrl:'https://chatgpt.com/backend-api/codex',apiKeyMasked:null,isDefault:false,managed:false,shared:false,kind:'chatgpt-oauth',external:true,connection:'connected'}]});
    if(p==='/api/providers/chatgpt/models'){
     calls.push(u.search);
     if(!u.searchParams.get('refresh'))return json({models:['gpt-synthetic-1','gpt-synthetic-mini'],cached:true,fetchedAt:1});
     if(mode==='ok')return json({models:['gpt-synthetic-1','gpt-synthetic-mini','gpt-synthetic-new'],cached:false,fetchedAt:2,throttled:false});
     if(mode==='throttled')return json({models:['gpt-synthetic-1','gpt-synthetic-mini','gpt-synthetic-new'],cached:true,fetchedAt:2,throttled:true});
     if(mode==='429')return json({error:'The ChatGPT model list was refreshed a moment ago. Try again in a few seconds.'},429);
     return json({error:'ChatGPT returned 503'},502);
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
   // Opening the picker never refreshes by itself.
   assert.deepEqual(calls,[''],'opening the picker reads the cached list once, with no refresh');
   const btn=dialog.getByRole('button',{name:'Refresh models',exact:true});await btn.waitFor();
   assert.equal(await dialog.getByRole('button',{name:/gpt-synthetic-new/}).count(),0);
   // Refreshed: new list, "updated".
   await btn.click();
   await dialog.getByRole('button',{name:/gpt-synthetic-new/}).waitFor();
   await dialog.getByText('Model list updated').waitFor();
   assert.deepEqual(calls.at(-1),'?refresh=1');
   // Throttled (200 + throttled) and 429: "try again", list stays.
   for(const m of ['throttled','429']){
    mode=m;await btn.click();
    await dialog.getByText('Try again in a few seconds').waitFor();
    await dialog.getByRole('button',{name:/gpt-synthetic-mini/}).waitFor();
    await dialog.getByText('Model list updated').waitFor({state:'detached'});
    if(m==='throttled')await page.screenshot({path:`${shots}/refresh-wait-${width}-${theme}.png`});
   }
   mode='fail';await btn.click();
   await dialog.getByText("Couldn't refresh the model list").waitFor();
   await dialog.getByRole('button',{name:/gpt-synthetic-mini/}).waitFor();
   mode='ok';await btn.click();await dialog.getByText('Model list updated').waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll at '+width);
   await page.screenshot({path:`${shots}/refresh-updated-${width}-${theme}.png`});
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS #1306 Refresh models: explicit only, ?refresh=1, updated / try-again / failed states keep the list. Shots in '+shots);
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
