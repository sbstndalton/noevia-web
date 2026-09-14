// Synthetic download/failure and draft-preservation checks; no real Diary access.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31336);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];let writes=0;
 const bytes=Buffer.from([80,75,0,255,13,10]);
 try{
 for(const [width,height] of [[320,568],[375,667],[390,360],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/diary/files?*',r=>r.fulfill({json:{files:[{path:'synthetic.md',name:'synthetic.md',isDir:false}]}}));
  await page.route('**/api/diary/file',r=>{if(r.request().method()==='PUT')writes++;return r.fulfill({json:{path:'synthetic.md',content:'# Stored synthetic',version:'v1'}});});
  let fail=true;
  await page.route('**/api/diary/workspace-export',r=>fail?r.fulfill({status:409,json:{error:'Finish pending Diary writes before exporting.'}}):r.fulfill({contentType:'application/zip',body:bytes}));
  await page.goto('http://localhost:31336');await page.getByRole('button',{name:'Diary',exact:true}).click();await page.getByRole('button',{name:'synthetic.md',exact:true}).click();
  const workspace=page.getByRole('region',{name:'Markdown workspace'});
  await workspace.getByLabel('Markdown content',{exact:true}).fill('Unsaved synthetic draft');
  await workspace.getByText('Export workspace',{exact:true}).click();const button=workspace.getByRole('button',{name:'Download workspace ZIP',exact:true});
  await button.click();await workspace.getByRole('alert').filter({hasText:'Finish pending'}).waitFor();
  fail=false;const downloaded=page.waitForEvent('download');await button.click();const download=await downloaded;
  assert.equal(download.suggestedFilename(),'noevia-workspace.zip');assert.deepEqual(fs.readFileSync(await download.path()),bytes);
  await workspace.getByText('Download ready. Check your browser downloads.',{exact:true}).waitFor();
  assert.equal(await workspace.getByLabel('Markdown content',{exact:true}).inputValue(),'Unsaved synthetic draft');
  assert.equal(await workspace.getByRole('alert').count(),0);await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert.ok(box.height>=44);assert.ok(box.x>=0&&box.x+box.width<=width);assert.ok(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Export button center is unobscured');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/noevia-workspace-export-${width}-${theme}.png`});await page.close();
 }
 assert.equal(writes,0);assert.equal(fixture.requests.length,0);assert.deepEqual(errors,[]);console.log('PASS export binary download, failure/retry, draft preservation, 44px controls, six viewports and both themes; zero writes/inference.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
