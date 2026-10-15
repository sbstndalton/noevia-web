// #1815: a source whose text file is gone on the server is listed with `textMissing: true`. Sources
// must say so on that row ("Text missing — re-upload or refresh"), in the same per-source status
// line the other states use, and a normal source keeps "Text ready". Synthetic APIs only. Fails
// before the change (the row reads "Text ready") and passes after it.
//   npm run build -- --outDir /tmp/noevia-qa-dist && QA_DIST=/tmp/noevia-qa-dist node qa/source-text-missing-1815.cjs
// Screenshots (2000 and 390, light and dark) go to $QA_SCREENSHOTS.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const PORT=31815,ORIGIN='http://localhost:'+PORT;
const shots=process.env.QA_SCREENSHOTS||'/tmp/noevia-qa-1815';
const REF_A='a'.repeat(64),REF_B='b'.repeat(64);
(async()=>{
 fs.mkdirSync(shots,{recursive:true});
 const fixture=createFixture(PORT);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,theme] of [[2000,'light'],[2000,'dark'],[390,'light'],[390,'dark']]){
   const page=await browser.newPage(withLocale({viewport:{width,height:width<600?900:1100},isMobile:width<768,hasTouch:width<768}));page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   const project={id:'p-notes',name:'Synthetic 1815',goal:'',instructions:'',memories:[],model:'synthetic',
    files:[{name:'kept-notes.md',chars:42,textRef:REF_A},{name:'lost-notes.md',chars:37,textRef:REF_B,textMissing:true}],
    assets:[],sourceFolders:[],toolboxes:['core'],modes:['chat'],chats:[],createdAt:1000,updatedAt:1000};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[project],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   await page.route('**/api/projects/*/sources/text*',r=>{
    const name=new URL(r.request().url()).searchParams.get('name');
    if(name==='lost-notes.md')return r.fulfill({status:404,json:{error:'The text of this source is missing. Re-upload or refresh it.',code:'SOURCE_TEXT_MISSING',name}});
    return r.fulfill({json:{name,content:'synthetic kept text for the 1815 check..',chars:42}});
   });
   await page.goto(ORIGIN+'/p/p-notes');
   await page.getByRole('tab',{name:/Sources/}).first().click().catch(async()=>{await page.getByText('Sources',{exact:true}).first().click();});
   const lost=page.locator('li[data-source-name="lost-notes.md"]');await lost.waitFor({timeout:15000});
   const kept=page.locator('li[data-source-name="kept-notes.md"]');await kept.waitFor();
   const lostStatus=lost.locator('small.source-status').first();
   assert.equal((await lostStatus.innerText()).trim(),'Text missing — re-upload or refresh','the missing source says so');
   assert.equal(await lostStatus.getAttribute('data-text-missing'),'true');
   assert.equal((await kept.locator('small.source-status').first().innerText()).trim(),'Text ready','a normal source is unchanged');
   assert.equal(await kept.locator('[data-text-missing]').count(),0);
   // Same look as the other per-source states: the class and computed style match the normal row's.
   const style=el=>el.evaluate(n=>{const s=getComputedStyle(n);return [s.fontSize,s.color,s.fontWeight].join('|');});
   assert.equal(await style(lostStatus),await style(kept.locator('small.source-status').first()),'no new design language');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll at '+width);
   await lost.scrollIntoViewIfNeeded();await page.waitForTimeout(500);
   await page.screenshot({path:`${shots}/source-text-missing-${width}-${theme}.png`});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS #1815: a source with textMissing reads "Text missing — re-upload or refresh" in its status line; a normal source reads "Text ready"; 2000/390, light and dark. Shots in '+shots);
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
