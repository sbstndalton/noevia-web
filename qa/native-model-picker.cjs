// The chat box's model panel. No inference, no model loads, no real storage.
//
// The panel is deliberately minimal now: Auto or one model, plus the tools.
// Roles, loaded/unloaded, MTP and downloads moved to Settings → Models &
// routing, so this asserts they are ABSENT here as much as what is present.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31334);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 for(const [width,height] of [[375,720],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));
  const project={id:'synthetic-native-context',name:'Synthetic',model:'Cold chat',routing:'auto',files:[],assets:[],toolboxes:['core']};
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/chats/*/context',r=>r.fulfill({json:{project}}));
  await page.route('**/api/providers',r=>r.fulfill({json:{providers:[{id:'default',label:'Native',baseUrl:'http://synthetic.invalid/v1',managed:true,isDefault:true}]}}));
  await page.route('**/api/auto-roles',r=>r.fulfill({json:{configured:true,roles:{fast:'Cold chat',smart:'Cold chat'}}}));
  await page.route('**/api/models/capabilities',r=>r.fulfill({json:{kind:'llamacpp',admin:false,presets:true,runtimeOptions:false}}));
  await page.route('**/api/toolboxes',r=>r.fulfill({json:{toolboxes:[{id:'core',label:'Core',description:'Clock and project files.',toolCount:2,estTokens:180,source:'builtin',available:true}],mcp:{configured:false,servers:[]}}}));
  await page.route('**/api/models/installed',r=>r.fulfill({json:[{name:'Embedding fixture',labels:['embeddings'],loaded:true},{name:'Ranking fixture',labels:['reranking'],loaded:false},{name:'Cold chat',labels:[],loaded:false}]}));
  // Switching to Manual is the only write the panel makes here.
  await page.route('**/api/projects/*/config',async r=>{project.routing='manual';await r.fulfill({json:{project}});});

  await page.goto('http://localhost:31334');
  await page.getByRole('button',{name:'Choose model'}).filter({hasText:'Auto (Fast/Smart)'}).waitFor();
  await page.getByRole('button',{name:'Choose model'}).click();
  const dialog=page.getByRole('dialog',{name:'Model and tools'});
  await dialog.waitFor();

  // Auto: a read-only summary of where it routes, and a way to change it.
  await dialog.getByText(/Routing to/).waitFor();
  assert.match(await dialog.getByText(/Routing to/).innerText(),/Fast: Cold chat/);
  assert.equal(await dialog.getByRole('button',{name:'Change in model settings'}).count(),1);
  // No role editors, no loaded/unloaded list, no MTP — those live in Settings.
  assert.equal(await dialog.locator('select').count(),0,'a role editor is still in the chat panel');
  assert.equal(await dialog.getByRole('button',{name:'Loaded models',exact:true}).count(),0);
  assert.equal(await dialog.getByText(/MTP/).count(),0);
  assert.equal(await dialog.getByRole('button',{name:'Save roles'}).count(),0);
  // Tools stay: they are per-project and belong with the model choice.
  assert.equal(await dialog.getByRole('checkbox',{name:/Core/}).count(),1);

  // Manual: the model list, with embedding and reranking models excluded.
  await dialog.getByRole('button',{name:/Manual/}).click();
  await dialog.locator('.mp-model').first().waitFor();
  assert.equal(await dialog.locator('.mp-model').count(),1);
  assert.match(await dialog.locator('.mp-model').innerText(),/Cold chat/);
  for(const hidden of ['Embedding fixture','Ranking fixture']) assert.equal(await dialog.getByText(hidden,{exact:true}).count(),0,`${hidden} is offered for chat`);

  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`overflow at ${width} ${theme}`);
  await page.screenshot({path:`/tmp/noevia-native-picker-${width}-${theme}.png`});
  // Tune goes straight to that model's settings on the full model manager page.
  const tune=dialog.getByRole('button',{name:'Tune Cold chat'});
  assert.ok(await tune.isVisible(),`Tune not visible at ${width}`);
  const box=await tune.boundingBox();assert.ok(box.height>=44,`Tune target ${box.height}px at ${width}`);
  await tune.click();
  await page.locator('.model-manager-page .mm-detail-head h1').filter({hasText:'Cold chat'}).waitFor();
  await page.close();
 }
 // A model deleted elsewhere: the composer stops naming it as the selection.
 {
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const project={id:'synthetic-native-context',name:'Synthetic',model:'Cold chat',routing:'manual',files:[],assets:[],toolboxes:['core']};
  let installed=[{name:'Cold chat',labels:[],loaded:false}];
  await page.route('**/api/chats/*/context',r=>r.fulfill({json:{project}}));
  await page.route('**/api/models/installed',r=>r.fulfill({json:installed}));
  await page.goto('http://localhost:31334');
  await page.getByRole('button',{name:'Choose model'}).filter({hasText:'Cold chat'}).waitFor();
  installed=[];
  await page.evaluate(()=>window.dispatchEvent(new Event('noevia:models-changed')));
  await page.getByRole('button',{name:'Choose model'}).filter({hasText:'No model selected'}).waitFor();
  await page.screenshot({path:'/tmp/noevia-native-picker-deleted.png'});
  // An unreadable catalogue must not claim the model is gone.
  await page.unroute('**/api/models/installed');
  await page.route('**/api/models/installed',r=>r.fulfill({status:502,json:{error:'synthetic outage'}}));
  await page.reload();
  await page.getByRole('button',{name:'Choose model'}).filter({hasText:'Cold chat'}).waitFor();
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);
 console.log('PASS chat model panel: auto summary with a settings link, manual list excluding embedding/reranking, tools kept, roles/loaded/MTP absent, a Tune button per model opening its settings page, three widths and both themes; deleted model reads No model selected, unreadable catalogue does not.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
