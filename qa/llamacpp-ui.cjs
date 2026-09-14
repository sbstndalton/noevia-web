// Browser contract against synthetic APIs only; no inference or private corpus.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31328);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});let conflict=true,applied=0,revision='one';const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/models/**',route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.pathname==='/api/models/capabilities')return route.fulfill({json:{kind:'llamacpp',admin:true,presets:true,runtimeOptions:false}});
 if(url.pathname==='/api/models/installed')return route.fulfill({json:[{name:'Synthetic native',labels:['vision'],loaded:false,sizeGB:6,maxContext:262144,source:'preset',canDelete:false,status:'unloaded'}]});
 if(url.pathname==='/api/models/preset'){
   if(req.method()==='PUT'){const body=req.postDataJSON();assert.equal(body.confirmReload,true);assert.equal(body.options['ctx-size'],'32768');if(conflict)return route.fulfill({status:409,json:{error:'Presets changed. Reload the profile before saving; your draft is retained.'}});assert.equal(body.baseRevision,'two');applied++;}
   return route.fulfill({json:{model:'Synthetic native',revision,options:{'ctx-size':applied?'32768':'8192',parallel:'1'},defaults:{'cache-type-k':'q8_0'},fields:['ctx-size','parallel','cache-type-k','spec-type']}});
 }
 return route.fulfill({json:[]});
 });
 await page.goto('http://localhost:31328');await page.getByRole('button',{name:'Choose model'}).click();await page.getByRole('button',{name:'Manage',exact:true}).click();
 await page.getByText('Native runtime profile',{exact:true}).click();await page.getByRole('button',{name:'Read profile',exact:true}).click();
 const input=page.getByLabel('Total context allocation (tokens)');await input.fill('32768');
 assert.equal(await page.getByRole('button',{name:'delete',exact:true}).count(),0);assert.equal(await page.getByText('Enable MTP?',{exact:true}).count(),0);
 const apply=page.getByRole('button',{name:'Apply profile and reload presets'});assert.equal(await apply.isEnabled(),false);await page.getByRole('checkbox').check();await apply.click();await page.getByRole('alert').waitFor();assert.equal(await input.inputValue(),'32768');
 revision='two';await page.getByRole('button',{name:'Read latest; retain draft'}).click();await page.getByText(/Latest revision loaded/).waitFor();assert.equal(await input.inputValue(),'32768');conflict=false;await apply.click();await page.getByText(/Profile applied. Model remains unloaded/).waitFor();assert.equal(applied,1);
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
 await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await input.focus();assert.equal(await input.evaluate(el=>getComputedStyle(el).outlineStyle==='none'),false);await page.screenshot({path:`/tmp/noevia-native-profile-${width}-${theme}.png`});
 }
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);console.log('PASS native profile browser: capabilities, protected preset delete, acknowledgement, stale conflict, retained draft, apply, keyboard focus, phone/tablet/desktop light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
