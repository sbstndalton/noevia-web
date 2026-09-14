// Synthetic browser regression; no real Diary storage or model calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31319);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page=await browser.newPage();let content='# Synthetic note',version='1',fail=false;
 await page.route('**/api/diary/files?*',route=>route.fulfill({json:{files:[{path:'note.md',name:'note.md',isDir:false}]}}));
 await page.route('**/api/diary/file',async route=>{
 const request=route.request(),body=request.postDataJSON();
 if(request.method()==='PUT'){
 if(fail)return route.fulfill({status:503,json:{error:'Synthetic storage unavailable'}});
 if(body.version!==version)return route.fulfill({status:409,json:{error:'File changed elsewhere. Draft kept.'}});
 content=body.content;version=String(Number(version)+1);
 }
 return route.fulfill({json:{path:'note.md',content,version}});
 });
 await page.goto('http://localhost:31319');await page.getByRole('button',{name:'Diary',exact:true}).click();await page.getByRole('button',{name:'note.md',exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'Markdown workspace'}),source=dialog.getByRole('textbox',{name:'Markdown content'});
 await dialog.getByRole('button',{name:'Edit Markdown',exact:true}).click();await source.fill('# My draft');
 fail=true;await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await source.inputValue(),'# My draft');
 fail=false;content='# External edit';version='2';await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByText('File changed elsewhere. Draft kept.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Compare stored version'}).click();await dialog.getByRole('heading',{name:'Current stored version'}).waitFor();assert.equal(await source.inputValue(),'# My draft');
 await dialog.getByRole('button',{name:'Keep draft with this save base'}).click();await source.fill('# Reconciled draft');await source.press('Control+s');await dialog.getByText('Saved',{exact:true}).first().waitFor();assert.equal(content,'# Reconciled draft');assert.ok(await dialog.isVisible());
 await dialog.getByRole('button',{name:'Source & preview',exact:true}).click();
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
 await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
 await page.screenshot({path:`/tmp/noevia-editor-${width}-${theme}.png`});
 }
 console.log('PASS editor save/failure/conflict/reconciliation/keyboard and responsive panes');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
