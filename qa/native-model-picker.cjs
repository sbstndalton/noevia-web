// Native model UI regression: no inference, model loads or real storage.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31334);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 for(const [width,height] of [[375,360],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));
  const project={id:'synthetic-native-context',name:'Synthetic',model:'Cold chat',routing:'auto',files:[],assets:[],toolboxes:[]};
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/chats/*/context',r=>r.fulfill({json:{project}}));
  await page.route('**/api/providers',r=>r.fulfill({json:{providers:[{id:'default',label:'Native',baseUrl:'http://synthetic.invalid/v1',managed:true,isDefault:true}]}}));
  await page.route('**/api/auto-roles',r=>r.fulfill({json:{configured:true,roles:{fast:'Cold chat',smart:'Cold chat'}}}));
  await page.route('**/api/models/capabilities',r=>r.fulfill({json:{kind:'llamacpp',admin:false,presets:true,runtimeOptions:false}}));
  await page.route('**/api/models/installed',r=>r.fulfill({json:[{name:'Embedding fixture',labels:['embeddings'],loaded:true},{name:'Ranking fixture',labels:['reranking'],loaded:false},{name:'Cold chat',labels:[],loaded:false}]}));
  await page.goto('http://localhost:31334');await page.getByRole('button',{name:'Choose model'}).filter({hasText:'Auto (Fast/Smart)'}).waitFor();await page.getByRole('button',{name:'Choose model'}).click();const dialog=page.getByRole('dialog');
  await dialog.getByText(/MTP is configured in the native runtime profile/).waitFor();
  assert.equal(await dialog.getByText(/Enable MTP/).count(),0);
  assert.equal(await dialog.locator('.model-row').count(),1);assert.match(await dialog.locator('.model-row').innerText(),/Cold chat/);
  assert.equal(await dialog.locator('option').filter({hasText:'Embedding fixture'}).count(),0);
  assert.equal(await dialog.locator('option').filter({hasText:'Ranking fixture'}).count(),0);
  assert.equal(await dialog.locator('select').count(),3);
  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:`/tmp/noevia-native-picker-${width}-${theme}.png`});
  await dialog.getByRole('button',{name:'Manage',exact:true}).click();await dialog.getByText('Embedding fixture',{exact:true}).waitFor();
  assert.equal(await dialog.getByText('Ranking fixture',{exact:true}).count(),1);
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);console.log('PASS native cold chat picker/auto roles exclude embedding and ranking; Manage preserves both; native MTP guidance, three widths and both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
