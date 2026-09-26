// Date/tag search uses only synthetic stored Markdown; no Diary inference or writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31335);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];let writes=0;
 const files={'2024-02-29.md':'# Synthetic leap day\nTarget #work','2024-03-01.md':'# Synthetic next day\nTarget #home','2024-03-02.md':'Target #work','notes.md':'Undated #work'};
 try{
 for(const [width,height] of [[320,568],[375,667],[390,360],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/diary/files?*',r=>r.fulfill({json:{files:Object.keys(files).map(path=>({path,name:path,isDir:false}))}}));
  await page.route('**/api/diary/file',r=>{if(r.request().method()==='PUT')writes++;const path=r.request().postDataJSON().path;return r.fulfill({json:{path,content:files[path]??null,version:'synthetic-v1'}});});
  await page.goto('http://localhost:31335');await navClick(page,'Diary');await page.getByRole('button',{name:'2024-02-29.md',exact:true}).click();
  const workspace=page.getByRole('region',{name:'Markdown workspace'});
  await workspace.getByLabel('Markdown content',{exact:true}).fill('Unsaved draft #different');
  await workspace.getByText('Search & backlinks',{exact:true}).click();
  await workspace.getByLabel('From date',{exact:true}).fill('2024-02-29');await workspace.getByLabel('Through date',{exact:true}).fill('2024-03-01');await workspace.getByLabel('Hashtag',{exact:true}).fill('#WORK');
  await workspace.getByRole('button',{name:'Search contents',exact:true}).click();await workspace.getByText('1 match · 2 files checked',{exact:true}).waitFor();
  assert.match(await workspace.locator('.diary-search-result').innerText(),/2024-02-29.md/);
  assert.equal(await workspace.getByLabel('Markdown content',{exact:true}).inputValue(),'Unsaved draft #different');
  await workspace.getByLabel('Hashtag',{exact:true}).fill('home');assert.equal(await workspace.locator('.diary-search-result').count(),0,'Changed filters invalidate old results');
  await workspace.getByRole('button',{name:'Search contents',exact:true}).click();await workspace.getByText('1 match · 2 files checked',{exact:true}).waitFor();assert.match(await workspace.locator('.diary-search-result').innerText(),/2024-03-01.md/);
  await workspace.getByRole('button',{name:'Clear filters',exact:true}).click();assert.equal(await workspace.getByLabel('From date',{exact:true}).inputValue(),'');assert.equal(await workspace.getByRole('button',{name:'Search contents',exact:true}).isEnabled(),false);
  await workspace.getByLabel('Hashtag',{exact:true}).fill('work');await workspace.getByRole('button',{name:'Search contents',exact:true}).click();await workspace.getByText('3 matches · 4 files checked',{exact:true}).waitFor();
  await workspace.getByLabel('From date',{exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await workspace.evaluate(el=>el.scrollWidth<=el.clientWidth),'Workspace fits');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/tmp/noevia-workspace-filters-${width}-${theme}.png`});
  await page.close();
 }
 assert.equal(writes,0);assert.equal(fixture.requests.length,0);assert.deepEqual(errors,[]);console.log('PASS date/tag-only and combined search, inclusive leap dates, stale result clearing, stored-source/draft preservation, six viewports and both themes; no writes or inference.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
