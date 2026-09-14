// Synthetic managed import UI; no real Diary access or inference.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31337);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 for(const [width,height] of [[320,568],[375,667],[390,360],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/diary/storage-status',r=>r.fulfill({json:{mode:'managed',backup:'not_configured'}}));
  await page.route('**/api/diary/files?*',r=>r.fulfill({json:{files:[{path:'synthetic.md',name:'synthetic.md',isDir:false}]}}));
  await page.route('**/api/diary/file',r=>r.fulfill({json:{path:'synthetic.md',content:'# Stored synthetic',version:'v1'}}));
  let fail=true,applies=0;
  await page.route('**/api/diary/workspace-import?*',r=>{
   const url=new URL(r.request().url()),name=url.searchParams.get('name');
   if(url.searchParams.get('action')==='apply'){applies++;assert.equal(url.searchParams.get('fingerprint'),'reviewed');return r.fulfill(fail?{status:502,json:{error:'Response unavailable. Retry with the same file and folder.'}}:{json:{destination:'Imports/Copy',fileCount:2,indexPending:true}});}
   return r.fulfill({json:{alreadyApplied:applies===2,fingerprint:'reviewed',destination:'Imports/'+name,fileCount:2,bytes:12,files:['raw/synthetic.md','image.bin'],directories:['empty'],duplicates:['raw/synthetic.md'],conflicts:name==='Occupied'?['Imports/Occupied']:[]}});
  });
  await page.goto('http://localhost:31337');await page.getByRole('button',{name:'Diary',exact:true}).click();await page.getByRole('button',{name:'synthetic.md',exact:true}).click();
  const workspace=page.getByRole('region',{name:'Markdown workspace'});await workspace.getByLabel('Markdown content',{exact:true}).fill('Unsaved synthetic draft');
  await workspace.getByText('Import workspace',{exact:true}).click();
  await workspace.getByLabel('Workspace ZIP',{exact:true}).setInputFiles({name:'synthetic.zip',mimeType:'application/zip',buffer:Buffer.from('synthetic')});
  const name=workspace.getByLabel('New folder name',{exact:true});await name.fill('Occupied');await workspace.getByRole('button',{name:'Preview import',exact:true}).click();
  const apply=workspace.getByRole('button',{name:'Apply import to new folder',exact:true});await apply.waitFor();assert.ok(await apply.isDisabled());
  await name.fill('Copy');assert.equal(await apply.count(),0);await workspace.getByRole('button',{name:'Preview import',exact:true}).click();await apply.click();await workspace.getByRole('alert').filter({hasText:'Response unavailable'}).waitFor();
  assert.equal(applies,1);fail=false;await apply.click();await workspace.getByRole('status').filter({hasText:'Imported 2 files'}).waitFor();assert.equal(applies,2);
  await workspace.getByRole('button',{name:'Preview import',exact:true}).click();await workspace.getByRole('status').filter({hasText:'already imported'}).waitFor();assert.equal(await apply.count(),0);assert.equal(applies,2);
  assert.equal(await workspace.getByLabel('Markdown content',{exact:true}).inputValue(),'Unsaved synthetic draft');
  const button=workspace.getByRole('button',{name:'Preview import',exact:true});await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0&&box.x+box.width<=width);assert.ok(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/noevia-workspace-import-${width}-${theme}.png`});await page.close();
 }
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);console.log('PASS import preview/conflict/invalidation/uncertain retry/draft preservation at six sizes in both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
