// Synthetic browser regression; no real Diary storage or model calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31319);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
 const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});let content='# Synthetic note',version='1',fail=false,failList=false;
 await page.route('**/api/diary/files?*',route=>route.fulfill(failList?{status:503,json:{error:'Synthetic listing unavailable'}}:{json:{files:[{path:'note.md',name:'note.md',isDir:false},{path:'linked.md',name:'linked.md',isDir:false}]}}));
 await page.route('**/api/diary/file',async route=>{
 const request=route.request(),body=request.postDataJSON();
 if(request.method()==='PUT'){
 if(fail)return route.fulfill({status:503,json:{error:'Synthetic storage unavailable'}});
 if(body.version!==version)return route.fulfill({status:409,json:{error:'File changed elsewhere. Draft kept.'}});
 content=body.content;version=String(Number(version)+1);
 }
 return route.fulfill({json:body.path==='linked.md'?{path:'linked.md',content:'# Linked note\n[Back](note.md)',version:'linked-v1'}:{path:'note.md',content,version}});
 });
 await page.route('**/api/diary/today?*',route=>{const month=new URL(route.request().url()).searchParams.get('month');return route.fulfill({json:{todayLog:`# ${month}-01\nSynthetic first day\n# ${month}-02\nSynthetic second day`,standingSections:{},memoryFiles:[]}});});
 await page.goto('http://localhost:31319');await page.getByRole('button',{name:'Diary',exact:true}).click();
 await page.locator('.calendar-dot').first().waitFor();
 const capture=page.getByRole('textbox',{name:'What’s on your mind today?'});
 await capture.fill('Synthetic retained draft');
 await page.getByRole('button',{name:'List',exact:true}).click();
 const dates=await page.locator('.diary-entry-row time').allTextContents();
 assert.equal(dates.length,2);assert.deepEqual(dates,[...dates].sort().reverse());
 assert.equal(await capture.inputValue(),'Synthetic retained draft');
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 assert.equal(await capture.inputValue(),'Synthetic retained draft');await capture.fill('');
 for (const width of [375,768,1100,1440]) {
 await page.setViewportSize({width,height:950});
 const primary=await page.locator('.diary-primary').boundingBox(),rail=await page.locator('.diary-context').boundingBox();
 assert.equal(await page.getByRole('button',{name:'note.md',exact:true}).count(),1,'one Diary file browser');
 assert.ok(width>1100 ? rail.x>=primary.x+primary.width-1 : rail.y>=primary.y+primary.height-1,'Diary context sits right or below');
 assert.equal(await page.locator('.diary-context').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.ok(await page.locator('.diary-layout').evaluate(el=>el.scrollWidth<=el.clientWidth));
 }
 await page.getByRole('button',{name:'note.md',exact:true}).first().click();
 const dialog=page.getByRole('region',{name:'Markdown workspace'}),source=dialog.getByRole('textbox',{name:'Markdown content'});
 await dialog.getByRole('button',{name:'Edit Markdown',exact:true}).click();await source.fill('# My draft');
 fail=true;await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await source.inputValue(),'# My draft');
 fail=false;content='# External edit';version='2';await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.getByText('File changed elsewhere. Draft kept.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Compare stored version'}).click();await dialog.getByRole('heading',{name:'Current stored version'}).waitFor();assert.equal(await source.inputValue(),'# My draft');
 await dialog.getByRole('button',{name:'Keep draft with this save base'}).click();await source.fill('# Reconciled draft');await source.press('Control+s');await dialog.getByText('Saved',{exact:true}).first().waitFor();assert.equal(content,'# Reconciled draft');assert.ok(await dialog.isVisible());await page.waitForFunction(()=>document.activeElement?.id==='diary-markdown-source');
 await dialog.getByRole('button',{name:'Source & preview',exact:true}).click();
 for(const width of [375,768,1440])for(const theme of ['light','dark']){
 await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
 await dialog.evaluate(el=>{el.scrollTop=0;});
 await page.waitForTimeout(350);
 assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
 const documentBox=await dialog.locator('.diary-workspace-document').boundingBox(),navigationBox=await dialog.locator('.diary-workspace-navigation').boundingBox();
 assert.ok(width>1100 ? navigationBox.x>=documentBox.x+documentBox.width : navigationBox.y>=documentBox.y+documentBox.height,'Markdown context sits right or below');
 assert.equal(await page.locator('.diary-context:visible').count(),0,'old context is absent from editor view');
 await page.screenshot({path:`/tmp/noevia-editor-${width}-${theme}.png`});
 }
 // Dirty navigation refuses discard, then explicit acceptance can reload.
 await source.fill('# Still private draft');
 page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Back to Diary'}).click();assert.equal(await source.inputValue(),'# Still private draft');
 await dialog.getByRole('button',{name:'Compare stored version'}).click();
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Discard draft and reload'}).click();assert.equal(await source.inputValue(),'# Reconciled draft');
 // Listing errors hide old rows and support an explicit retry.
 failList=true;await dialog.getByRole('button',{name:'Refresh files'}).click();await dialog.getByText('Synthetic listing unavailable',{exact:true}).waitFor();assert.equal(await dialog.getByRole('navigation',{name:'Markdown files'}).count(),0);
 failList=false;await dialog.getByRole('button',{name:'Retry file list'}).click();await dialog.getByRole('button',{name:'note.md',exact:true}).waitFor();
 await dialog.getByText('Search & backlinks',{exact:true}).click();await dialog.getByLabel('Search text',{exact:true}).fill('Reconciled');await dialog.getByRole('button',{name:'Search contents',exact:true}).click();await dialog.getByText('1 matches · 2 files checked',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Find links to this file'}).click();await dialog.getByText('1 linking files · 2 files checked',{exact:true}).waitFor();
 // Export contains the unsaved source verbatim and does not save it to storage.
 const linkDraft='---\ntitle: Portable\n---\n# Links\n[Open linked](linked.md)\n[Unsafe](javascript:bad.md)';await source.fill(linkDraft);
 const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download Markdown'}).click();const file=await downloaded;assert.equal(require('node:fs').readFileSync(await file.path(),'utf8'),linkDraft);assert.equal(content,'# Reconciled draft');
 await dialog.getByRole('button',{name:'Preview',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'Unsafe',exact:true}).count(),0);
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Open linked',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.diary-editor-path input')?.value==='linked.md');
 await dialog.getByRole('button',{name:'Back to Diary'}).click();
 // A separate in-memory folder exercises local conflict handling, never a disk corpus.
 const local=await browser.newPage();await local.addInitScript(()=>{
 const files={'note.md':'# Local original'};window.__fixtureFiles=files;window.__failDisk=false;
 const root={kind:'directory',name:'Synthetic editor folder',async *values(){for(const name of Object.keys(files))yield await this.getFileHandle(name);},getDirectoryHandle:async()=>root,getFileHandle:async(name,opts)=>{
 if(!(name in files)&&!opts?.create)throw new DOMException('Missing','NotFoundError');
 return{kind:'file',name,getFile:async()=>new File([files[name]||''],name),createWritable:async()=>{if(window.__failDisk)throw Error('Synthetic disk failure');let next;return{write:async text=>{next=text;},close:async()=>{files[name]=next;},abort:async()=>{}};}};
 }};window.showDirectoryPicker=async()=>root;
 });
 await local.goto('http://localhost:31319');await local.getByRole('button',{name:'Diary',exact:true}).click();await local.getByRole('button',{name:'Edit',exact:true}).click();await local.getByRole('button',{name:'Folder on this computer'}).click();await local.getByRole('checkbox',{name:/Also sync/}).uncheck();await local.getByRole('button',{name:'Choose folder',exact:true}).click();await local.getByRole('button',{name:'note.md',exact:true}).click();
 const workspace=local.getByRole('region',{name:'Markdown workspace'}),input=workspace.getByRole('textbox',{name:'Markdown content'});
 await input.fill('# Local draft');await local.evaluate(()=>{window.__failDisk=true;});await workspace.getByRole('button',{name:'Save',exact:true}).click();await workspace.getByRole('alert').waitFor();assert.equal(await input.inputValue(),'# Local draft');
 await local.evaluate(()=>{window.__failDisk=false;window.__fixtureFiles['note.md']='# Other writer';});await workspace.getByRole('button',{name:'Save',exact:true}).click();await workspace.getByRole('heading',{name:'Current stored version'}).waitFor();assert.equal(await local.evaluate(()=>window.__fixtureFiles['note.md']),'# Other writer');
 await workspace.getByRole('button',{name:'Keep draft with this save base'}).click();await input.press('Control+s');await workspace.getByText('Saved locally',{exact:true}).first().waitFor();assert.equal(await local.evaluate(()=>window.__fixtureFiles['note.md']),'# Local draft');
 // A remote sync failure must not roll back the local saved baseline.
 let remoteContent='# Local draft',remoteVersion='r1',syncFailure=true;
 await local.route('**/api/diary/file',async route=>{
 const request=route.request(),body=request.postDataJSON();
 if(request.method()==='PUT'){
 if(syncFailure)return route.fulfill({status:503,json:{error:'Synthetic sync failure'}});
 assert.equal(body.version,remoteVersion);remoteContent=body.content;remoteVersion='r2';
 }
 return route.fulfill({json:{path:body.path,content:remoteContent,version:remoteVersion}});
 });
 await workspace.getByRole('button',{name:'Back to Diary'}).click();await local.getByRole('checkbox',{name:/Also sync/}).check();await local.getByRole('button',{name:'note.md',exact:true}).click();
 await input.fill('# Saved only locally');await workspace.getByRole('button',{name:'Save',exact:true}).click();await workspace.getByText('Saved locally · sync needs attention',{exact:true}).waitFor();assert.equal(await local.evaluate(()=>window.__fixtureFiles['note.md']),'# Saved only locally');assert.equal(remoteContent,'# Local draft');
 syncFailure=false;await input.fill('# New local and remote draft');await workspace.getByRole('button',{name:'Save',exact:true}).click();await workspace.getByText('Saved locally and synced',{exact:true}).first().waitFor();assert.equal(remoteContent,'# New local and remote draft');
 assert.equal(fixture.requests.length,0,'editing never invokes a model');
 console.log('PASS editor save/failure/conflict/reconciliation/keyboard and responsive panes');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
