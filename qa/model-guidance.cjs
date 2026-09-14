// Real browser against synthetic APIs. No model installation, inference or provider traffic.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31320);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});let fail=false,mutations=0;
 await page.route('**/api/models/**',route=>{
 const req=route.request(),url=new URL(req.url());
 if(req.method()!=='GET'){mutations++;return route.fulfill({status:400,json:{error:'No model mutations allowed'}});}
 if(url.pathname==='/api/models/hardware')return route.fulfill({json:{source:'model-manager',cpu:'Synthetic CPU',systemGB:32,gpus:[{id:'amd:0',name:'Synthetic GPU',capacityGB:8,sharedGB:16}]}});
 if(url.pathname==='/api/models/installed')return route.fulfill(fail?{status:503,json:{error:'Synthetic manager unavailable'}}:{json:[
 {name:'Synthetic Small',labels:['tool_use'],loaded:true,sizeGB:4,maxContext:8192},
 {name:'Synthetic Vision',labels:['vision'],loaded:false,sizeGB:9,maxContext:16384},
 {name:'Synthetic Huge',labels:['reasoning'],loaded:false,sizeGB:40,maxContext:32768},
 {name:'Synthetic Unknown',labels:[],loaded:false,sizeGB:null,maxContext:null}]});
 if(url.pathname==='/api/models/search')return route.fulfill({json:[{repo:'synthetic/model',name:'Synthetic model',downloads:1}]});
 if(url.pathname==='/api/models/variants')return route.fulfill({json:[{id:'synthetic/model:Q4',label:'Q4',sizeGB:4},{id:'synthetic/model:Q8',label:'Q8',sizeGB:20}]});
 return route.fulfill({json:[]});
 });
 await page.goto('http://localhost:31320');await page.getByRole('button',{name:'Choose model'}).click();await page.getByRole('button',{name:'Guidance',exact:true}).click();
 const guidance=page.getByRole('region',{name:'Model guidance'});
 await guidance.getByRole('heading',{name:'Synthetic Small',exact:true}).waitFor();assert.equal(await guidance.getByText('Fit unknown',{exact:true}).count(),4);
 await guidance.getByRole('button',{name:'Read inference hardware'}).click();await guidance.getByRole('button',{name:'Use reported system capacity'}).waitFor();assert.equal(await guidance.getByLabel('Capacity (GB)').inputValue(),'');await guidance.getByRole('button',{name:'Use Synthetic GPU capacity'}).click();assert.equal(await guidance.getByLabel('Capacity (GB)').inputValue(),'8');assert.equal(await guidance.getByLabel('Memory pool').inputValue(),'gpu');
 await guidance.getByLabel('Capacity (GB)').fill('16');await guidance.getByText('Room in planned budget',{exact:true}).first().waitFor();
 assert.equal(await guidance.getByText('Over planned budget',{exact:true}).count(),1);
 await guidance.getByLabel('Required capability').selectOption('vision');assert.equal(await guidance.locator('article').count(),1);assert.match(await guidance.locator('article').innerText(),/Synthetic Vision/);
 await guidance.getByLabel('Required capability').selectOption('tools');assert.match(await guidance.locator('article').innerText(),/Synthetic Small/);
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
 await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);await page.waitForTimeout(350);
 assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:`/tmp/noevia-model-guidance-${width}-${theme}.png`});
 }
 await page.getByRole('button',{name:'Download',exact:true}).click();await page.getByPlaceholder('Search Hugging Face models…').fill('synthetic');await page.getByRole('button',{name:'Go',exact:true}).click();await page.getByRole('button',{name:'variants',exact:true}).click();
 await page.getByText('Room in planned budget',{exact:true}).waitFor();await page.getByText('Over planned budget',{exact:true}).waitFor();assert.equal(await page.getByText(/recommended quant/).count(),0);
 fail=true;await page.getByRole('button',{name:'Guidance',exact:true}).click();await guidance.getByRole('alert').waitFor();fail=false;await guidance.getByRole('button',{name:'Retry models'}).click();await guidance.getByRole('heading',{name:'Synthetic Small',exact:true}).waitFor();
 assert.equal(mutations,0);assert.equal(fixture.requests.length,0);console.log('PASS model guidance unknown/fit/capability/failure/retry/variant budget/responsive/no mutations');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
