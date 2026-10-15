// #1809: two project sources that share a file name (folder import) must be told apart on their chips.
// Synthetic APIs only. Fails before the change (both chips read `readme.md`) and passes after it.
//   npm run build -- --outDir /tmp/noevia-qa-dist && QA_DIST=/tmp/noevia-qa-dist node qa/source-chip-paths-1809.cjs
// Screenshots (2000 and 390, light and dark) go to $QA_SCREENSHOTS.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const PORT=31809,ORIGIN='http://localhost:'+PORT;
const shots=process.env.QA_SCREENSHOTS||'/tmp/noevia-qa-1809';
(async()=>{
 fs.mkdirSync(shots,{recursive:true});
 const fixture=createFixture(PORT);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,theme] of [[2000,'light'],[2000,'dark'],[390,'light'],[390,'dark']]){
   const page=await browser.newPage(withLocale({viewport:{width,height:width<600?900:1100},isMobile:width<768,hasTouch:width<768}));page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   const names=['qa-t6-folder/readme.md','qa-t6-folder/docs/readme.md','qa-t6-folder/docs/api/auth.md','solo-note.md'];
   const project={id:'p-notes',name:'Folder import',goal:'',instructions:'',memories:[],model:'synthetic',
    files:names.map(name=>({name,content:'synthetic '+name})),assets:[],sourceFolders:[],toolboxes:['core'],modes:['chat'],chats:[],createdAt:1000,updatedAt:1000};
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
    const src=(file,snippet)=>({id:file,file,snippet,kind:'excerpt'});
    r.fulfill({status:200,headers:{'Content-Type':'text/event-stream'},body:ev({type:'meta',model:'synthetic',chatId})
     +ev({type:'sources',sources:[src('qa-t6-folder/docs/api/auth.md','CEDAR-33'),src('qa-t6-folder/readme.md','root readme'),src('qa-t6-folder/docs/readme.md','docs readme'),src('solo-note.md','solo')]})
     +ev({type:'delta',text:'The synthetic answer.'})+ev({type:'done',model:'synthetic'})});
   });
   await page.goto(ORIGIN+'/p/p-notes/new');
   const box=page.getByPlaceholder('Message noevia…');await box.waitFor();await box.fill('what is the nested auth code?');await box.press('Enter');
   await page.getByText('The synthetic answer.').waitFor();
   const group=page.getByRole('group',{name:'Sources:'});await group.waitFor();
   const chips=group.getByRole('button');
   // A unique file keeps its bare name; the two readmes get the shortest tail that tells them apart.
   assert.deepEqual(await chips.allInnerTexts(),['auth.md','qa-t6-folder/readme.md','docs/readme.md','solo-note.md']);
   // The full path is the accessible name and the tooltip.
   await group.getByRole('button',{name:'Open source qa-t6-folder/docs/api/auth.md',exact:true}).waitFor();
   const docs=group.getByRole('button',{name:'Open source qa-t6-folder/docs/readme.md',exact:true});await docs.waitFor();
   assert.match(await docs.getAttribute('title'),/^qa-t6-folder\/docs\/readme\.md\ndocs readme$/);
   assert.equal(new Set(await chips.allInnerTexts()).size,4,'no two chips read the same');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll at '+width);
   await chips.first().waitFor();await page.waitForTimeout(900);
   await page.screenshot({path:`${shots}/source-chips-${width}-${theme}.png`});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS #1809 source chips: same-named folder files read apart, full path in title and accessible name. Shots in '+shots);
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
