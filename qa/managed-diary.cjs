// Synthetic UI only: no private corpus or inference calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const {navClick}=require('./nav.cjs');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31339);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});
  let status={mode:'managed',backup:'pending',lastBackedUp:null},imports=0;
  await page.route('**/api/diary/storage-status',route=>route.fulfill({json:status}));
  await page.route('**/api/diary/storage-import',route=>{
   const body=route.request().postDataJSON();imports++;
   if(body.fingerprint){status={mode:'managed',backup:'pending',lastBackedUp:null};return route.fulfill({json:{imported:true,fileCount:1}});}
   return route.fulfill({json:{fingerprint:'synthetic-fingerprint',fileCount:1,bytes:12,files:[{path:'Entries/'+('long-filename-'.repeat(20))+'.md',bytes:12,sha256:'synthetic'}]}});
  });
  await page.goto('http://localhost:31339');await navClick(page,'Diary');
  const panel=page.locator('.diary-backup-status');await panel.getByText(/Backup pending/).waitFor();
  const draft=page.getByRole('textbox',{name:'What’s on your mind today?'});await draft.fill('Unsaved synthetic draft');
  status={mode:'managed',backup:'failed',lastBackedUp:null,error:'Synthetic remote conflict; app saves are retained.'};
  await panel.getByText(/Backup failed/).waitFor();assert.equal(await draft.inputValue(),'Unsaved synthetic draft');
  status={mode:'managed',backup:'complete',lastBackedUp:Date.now()/1000};await panel.getByText('All saved changes backed up').waitFor();
  assert.equal(await draft.inputValue(),'Unsaved synthetic draft');
  status={mode:'legacy',backup:'not_configured',lastBackedUp:null};
  await panel.getByRole('button',{name:'Preview import into noevia'}).click();await panel.getByText('Review file list').click();
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
   await panel.scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
   assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),'status overflow');
   const summary=panel.locator('summary');await page.keyboard.press('Tab');await summary.focus();
   assert.ok(await summary.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'),'focus outline');
   await page.screenshot({path:`/tmp/noevia-managed-${width}-${theme}.png`});
  }
  await panel.getByRole('button',{name:'Copy verified files & use app storage'}).click();
  await panel.getByText(/Backup pending/).waitFor();assert.equal(imports,2);
  assert.equal(await panel.getByText('Review file list').count(),0);
  await page.locator('.diary-context').getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('button',{name:/Backup connection/}).click();
  await page.getByText(/also used by Projects/).waitFor();
  assert.equal(await page.locator('option[value="s3"]').count(),0);
  assert.equal(await page.getByRole('combobox',{name:'Diary storage type'}).inputValue(),'nextcloud');
  console.log(JSON.stringify({result:'PASS',responsive:[375,768,1440],themes:['light','dark'],noOverflow:true,keyboardFocus:true,draftRetained:true,verifiedImport:true}));
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
