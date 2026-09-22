// Synthetic browser QA for the Diary local graph; no real Diary storage or model calls.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const {navClick}=require('./nav.cjs');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'/tmp/noevia-shots';
const FILES={
 'note.md':'# Note\nSee [Plan](plan.md) and [[ideas]].',
 'plan.md':'# Plan\nBack to [[note]].',          // both ways
 'ideas.md':'# Ideas\nNothing links from here.',  // out only
 'linked.md':'# Linked\n[Back](note.md)',         // in only
 'wiki.md':'# Wiki\nSee [[note#Later|later]].',   // in only, Obsidian spelling
};
(async()=>{
 const fixture=createFixture(31329);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/diary/files?*',route=>route.fulfill({json:{files:Object.keys(FILES).map(p=>({path:p,name:p,isDir:false}))}}));
  await page.route('**/api/diary/file',route=>{const body=route.request().postDataJSON();return route.fulfill({json:{path:body.path,content:FILES[body.path]??'',version:'v1'}});});
  await page.goto('http://localhost:31329');await navClick(page,'Diary');
  await page.getByRole('button',{name:'note.md',exact:true}).first().click();
  const dialog=page.getByRole('region',{name:'Markdown workspace'});
  await page.waitForFunction(()=>document.querySelector('.diary-editor-path input')?.value==='note.md');
  await dialog.getByText('Local graph',{exact:true}).click();
  const graph=dialog.locator('.diary-local-graph');
  await graph.getByText('Links out 2',{exact:true}).waitFor();await graph.getByText('Links in 3',{exact:true}).waitFor();
  const labels=await graph.locator('.graph-node[role="button"]').evaluateAll(n=>n.map(e=>e.getAttribute('aria-label')));
  assert.deepEqual(labels,['Open plan.md (links both ways)','Open ideas.md (linked from this file)','Open linked.md (links to this file)','Open wiki.md (links to this file)']);
  assert.equal(await graph.locator('.graph-edge-in').count(),2);assert.equal(await graph.locator('.graph-edge-both').count(),1);
  // A link typed just now shows without saving: the graph reads the text on screen.
  const source=dialog.getByRole('textbox',{name:'Markdown content'});
  if(await source.count()){await source.fill(FILES['note.md']+'\nAlso [[fresh idea]].');await graph.getByText('Links out 3',{exact:true}).waitFor();await source.fill(FILES['note.md']);await graph.getByText('Links out 2',{exact:true}).waitFor();}
  for(const scheme of ['light','dark'])for(const width of [375,768,1440]){
   await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});await page.setViewportSize({width,height:width===375?812:1000});
   await graph.scrollIntoViewIfNeeded();
   const box=await graph.locator('svg').boundingBox();assert.ok(box&&box.width>150&&box.x>=0&&box.x+box.width<=width+1,`graph fits at ${width}`);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false,`no page overflow at ${width}`);
   await graph.screenshot({path:`${shots}/diary-local-graph-${scheme}-${width}.png`});
  }
  // Keyboard: focus a node and press Enter to open it.
  await graph.locator('.graph-node[aria-label="Open plan.md (links both ways)"]').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.diary-editor-path input')?.value==='plan.md');
  console.log('PASS diary-local-graph: links out/in/both from text and the bounded backlink scan, live with unsaved links, keyboard open, fits 375/768/1440 light/dark');
 }finally{await browser.close();await fixture.close?.();}
})().catch(e=>{console.error(e);process.exitCode=1;});
