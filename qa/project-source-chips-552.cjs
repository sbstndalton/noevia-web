// #552: a project reply names the sources that went into its prompt. Synthetic APIs only.
// Fails before the change (no `sources` event is read, no chip exists) and passes after it.
//   npm run build -- --outDir /tmp/noevia-qa-dist && QA_DIST=/tmp/noevia-qa-dist node qa/project-source-chips-552.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const PORT=31552,ORIGIN='http://localhost:'+PORT;
(async()=>{
 const fixture=createFixture(PORT);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,theme] of [[375,'light'],[768,'dark'],[1440,'light'],[1440,'dark']]){
   const page=await browser.newPage({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   // The project was renamed after this file synced, so its stored name is a stale storage path.
   const stalePath='noevia projects/Old name/Text/longline-notes-about-the-quarterly-planning-cycle.txt';
   const project={id:'p-notes',name:'Notes',goal:'',instructions:'',memories:[],model:'synthetic',
    files:[{name:'note-a.md',content:'alpha'},{name:stalePath,content:'x'.repeat(5000),source:'noevia projects/Old name'}],
    assets:[],sourceFolders:[],toolboxes:['core'],modes:['chat'],chats:[],createdAt:1000,updatedAt:1000};
   let saved=null,chatId=null;
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...project,chats:chatId?[{id:chatId,title:'Sources',preview:'q',updatedAt:Date.now()}]:[]}],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   await page.route('**/api/projects/*/sources/sync',r=>r.fulfill({json:{updated:[],skipped:[]}}));
   await page.route('**/api/chats/*/history',async r=>{
    if(r.request().method()==='POST'){saved=JSON.parse(r.request().postData()).history;return r.fulfill({json:{ok:true,revision:'r1'}});}
    return r.fulfill({json:{history:saved||[],revision:'r1'}});
   });
   await page.route('**/api/chat',async r=>{
    const body=JSON.parse(r.request().postData());chatId=body.chatId;
    const ev=o=>'data: '+JSON.stringify(o)+'\n\n';
    r.fulfill({status:200,headers:{'Content-Type':'text/event-stream'},body:ev({type:'meta',model:'synthetic',chatId})
     +ev({type:'sources',sources:[{id:'note-a.md',file:'note-a.md',snippet:'alpha passage',kind:'file'},{id:stalePath,file:stalePath,snippet:'buried fact',kind:'excerpt',score:0.812},{id:'note-a.md',file:'note-a.md',snippet:'again',kind:'excerpt'}]})
     +ev({type:'delta',text:'The synthetic answer.'})+ev({type:'done',model:'synthetic'})});
   });
   await page.goto(ORIGIN+'/p/p-notes/new');
   const box=page.getByPlaceholder('Message noevia…');await box.waitFor();await box.fill('what did the notes say?');await box.press('Enter');
   await page.getByText('The synthetic answer.').waitFor();

   // One chip per file, showing the file's own name (not the stale storage path prefix).
   const group=page.getByRole('group',{name:'Sources:'});await group.waitFor();
   const chips=group.getByRole('button');
   assert.deepEqual(await chips.allInnerTexts(),['note-a.md','longline-notes-about-the-quarterly-planning-cycle.txt']);
   assert.equal(await group.locator('text=Old name').count(),0,'no stale path in a chip');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the reply scrolls sideways at '+width);
   const cw=await group.evaluate(g=>g.getBoundingClientRect().right<=innerWidth+1);assert.ok(cw,'chips stay inside the viewport at '+width);
   if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/source-chips-${width}-${theme}.png`});

   // The context panel names the file, not its stale path (wide layouts show it).
   if(width>=1024){
    const insp=page.locator('.insp-list');assert.equal(await insp.getByText('Old name').count(),0,'inspector shows a stale storage path');
    await insp.getByRole('button',{name:'Open source longline-notes-about-the-quarterly-planning-cycle.txt'}).waitFor();
   }

   // Persisted with the turn: the saved history carries the sources; a reload still shows the chips.
   await new Promise(r=>setTimeout(r,600));
   assert.ok(saved&&saved.some(m=>m.role==='assistant'&&Array.isArray(m.sources)&&m.sources.length===3),'the assistant turn is saved with its sources');
   await page.goto(ORIGIN+'/c/'+chatId);
   await page.getByRole('group',{name:'Sources:'}).getByRole('button').first().waitFor();

   // Keyboard: Tab to a chip, Enter opens that file's row in the project's Sources tab.
   const first=page.getByRole('group',{name:'Sources:'}).getByRole('button',{name:'Open source note-a.md'});
   await first.focus();assert.equal(await first.evaluate(e=>e===document.activeElement),true);
   await page.keyboard.press('Enter');
   await page.locator('.project-sources').waitFor();
   const row=page.locator('.source-list > li.is-cited');await row.waitFor();
   assert.match(await row.innerText(),/note-a\.md/);
   assert.equal(await row.evaluate(e=>e===document.activeElement),true,'the opened source row takes focus');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the Sources tab scrolls sideways at '+width);
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS project source chips: sources event read, one keyboard-operable chip per file with its own name, saved with the turn and restored on reload, opens the Sources row, no overflow at 375/768/1440, light and dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
