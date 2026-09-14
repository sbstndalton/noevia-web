// Synthetic managed recovery UI only. No private corpus or inference.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31338);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 for(const [width,height] of [[320,568],[375,667],[390,360],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/diary/storage-status',r=>r.fulfill({json:{mode:'managed',backup:'not_configured'}}));
  let trashed=false,fail=true,conflict=true;let ids=[];let record;
  await page.route('**/api/diary/files?*',r=>r.fulfill({json:{files:trashed?[]:[{path:'synthetic.md',name:'synthetic.md',isDir:false}]}}));
  await page.route('**/api/diary/file',r=>r.fulfill({json:{path:'synthetic.md',content:'# Stored synthetic',version:'v1'}}));
  await page.route('**/api/diary/workspace-trash*',r=>{
   if(r.request().method()==='GET')return r.fulfill({json:{records:record?[record]:[],next:null}});
   const body=r.request().postDataJSON();
   if(body.action==='trash'){
    ids.push(body.id);record={id:body.id,path:body.path,version:body.version,state:'trashed',trashedAt:1};trashed=true;
    if(fail){fail=false;return r.fulfill({status:502,json:{error:'Response unavailable. Retry or refresh Trash.'}});}
    return r.fulfill({json:record});
   }
   assert.equal(body.id,record.id);
   if(conflict){conflict=false;return r.fulfill({status:409,json:{error:'The original path is occupied. Restore never overwrites existing data.'}});}
   record={...record,state:'restored'};trashed=false;return r.fulfill({json:record});
  });
  await page.goto('http://localhost:31338');if(width===375)await page.addStyleTag({content:'html { font-size: 20px !important; }'});await page.getByRole('button',{name:'Diary',exact:true}).click();await page.getByRole('button',{name:'synthetic.md',exact:true}).click();
  const workspace=page.getByRole('region',{name:'Markdown workspace'}),source=workspace.getByLabel('Markdown content',{exact:true});
  await workspace.getByText('Trash & recovery',{exact:true}).click();const move=workspace.getByRole('button',{name:'Move current file to Trash',exact:true});
  await source.fill('Unsaved synthetic draft');assert.ok(await move.isDisabled());await source.fill('# Stored synthetic');assert.ok(await move.isEnabled());
  await move.click();await workspace.getByRole('alert').filter({hasText:'Response unavailable'}).waitFor();assert.equal(await source.inputValue(),'# Stored synthetic');
  await move.click();await workspace.getByRole('status').filter({hasText:'Moved to Trash'}).waitFor();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
  let restore=workspace.getByRole('button',{name:'Restore synthetic.md',exact:true});await restore.click();await workspace.getByRole('alert').filter({hasText:'occupied'}).waitFor();assert.equal(await source.inputValue(),'# Stored synthetic');
  await restore.scrollIntoViewIfNeeded();let box=await restore.boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0&&box.x+box.width<=width);assert.ok(await restore.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  await page.screenshot({path:`/tmp/noevia-workspace-trash-${width}-${theme}.png`});await restore.click();await workspace.getByRole('status').filter({hasText:'Restored to the original path'}).waitFor();assert.equal(await restore.count(),0);
  assert.equal(await source.inputValue(),'# Stored synthetic');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Same path and version can be trashed again with a new operation identity.
  await move.click();await workspace.getByRole('button',{name:'Restore synthetic.md',exact:true}).waitFor();assert.notEqual(ids[2],ids[1]);
  await page.reload();await page.getByRole('button',{name:'Diary',exact:true}).click();
  // Open a new editor to reach recovery even when the folder has no active files.
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByText('Trash & recovery',{exact:true}).click();await page.getByRole('button',{name:'Load Trash',exact:true}).click();await page.getByRole('button',{name:'Restore synthetic.md',exact:true}).waitFor();
  await page.close();
 }
 assert.deepEqual(errors,[]);assert.equal(fixture.requests.length,0);console.log('PASS trash dirty guard, uncertain retry, collision recovery, reload and touch reachability at six sizes in both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
