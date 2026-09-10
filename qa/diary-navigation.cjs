const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture();await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  for(const local of [false,true]){
   const context=await browser.newContext({timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>{throw Error('Unexpected discard confirmation');});
   await page.clock.install({time:new Date('2026-09-11T02:30:00Z')});
   await page.addInitScript(()=>{
    const files={};window.__fixtureFiles=files;
    const directory=(prefix='')=>({kind:'directory',name:prefix||'Synthetic folder',async *values(){for(const [name,text]of Object.entries(files))yield{kind:'file',name,getFile:async()=>new File([text],name)};},getDirectoryHandle:async name=>directory(prefix+name+'/'),getFileHandle:async(name,opts)=>{const key=prefix+name;if(!(key in files)&&!opts?.create)throw new DOMException('Missing','NotFoundError');return{kind:'file',name,getFile:async()=>new File([files[key]||''],name),createWritable:async()=>({write:async text=>{files[key]=text;},close:async()=>{},abort:async()=>{}})};}});
    window.showDirectoryPicker=async()=>directory();
   });
   await page.goto('http://localhost:31239');await page.getByRole('button',{name:'Diary',exact:true}).click();
   if(local){await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:'Folder on this computer'}).click();await page.getByRole('checkbox',{name:/Also sync/}).uncheck();await page.getByRole('button',{name:'Choose folder',exact:true}).click();}
   const send=async message=>{await page.locator('#diary-draft').fill(message);await page.getByRole('button',{name:'Send diary message'}).click();};
   await send('first synthetic');
   await page.getByRole('heading',{name:'September 10, 2026',exact:true}).waitFor();
   assert.match(await page.locator('.diary-conversation [data-role=user]').innerText(),/You\s+first synthetic/);
   await page.getByText(local?'Synthetic local reply':'Synthetic streamed reply',{exact:true}).waitFor();
   await page.locator('.thinking-block summary').click();
   await page.getByText('Synthetic provider reasoning',{exact:true}).waitFor();
   assert.ok(fixture.requests.at(-1).body.entryTime.startsWith('2026-09-10T22:30:'));
   assert.equal(fixture.requests.at(-1).body.entryDay,'2026-09-10');
   if(local)assert.ok(await page.evaluate(()=>Object.keys(window.__fixtureFiles).some(x=>x.includes('2026-09-10'))));
   for(const width of [375,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:950});await page.evaluate(t=>{document.documentElement.setAttribute('data-theme',t);localStorage.setItem('cowork-theme',t);},theme);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.evaluate(()=>{
      const input=document.querySelector('#diary-draft'), scroll=document.querySelector('.diary-content-scroll');
      return !scroll.contains(input) && input.getBoundingClientRect().bottom < innerHeight;
    }));
    await page.locator('#diary-draft').focus();await page.keyboard.press('Tab');
    assert.notEqual(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none');
    if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/diary-${local}-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
   }
   await page.locator('.diary-home-link').click();await send('second synthetic');
   await page.getByRole('button',{name:'Send diary message'}).waitFor();
   await page.waitForFunction(()=>document.querySelector('.diary-conversation')?.getAttribute('aria-busy')==='false');
   assert.equal(fixture.requests.at(-1).body.history.length,2);
   assert.ok(fixture.requests.at(-1).body.history.every(t=>!('reasoning' in t)));
   assert.equal(await page.locator('.thinking-block').count(),2);
   assert.equal(fixture.requests.at(-1).body.history[0].content,'first synthetic');
   await page.locator('.diary-breadcrumb').getByRole('button',{name:'September 2026'}).click();
   await page.getByRole('button',{name:'September 9, 2026, no entries',exact:true}).click();await send('past synthetic');
   await page.waitForFunction(()=>document.querySelector('.diary-conversation')?.getAttribute('aria-busy')==='false');
   assert.equal(fixture.requests.at(-1).body.entryDay,'2026-09-09');assert.equal(fixture.requests.at(-1).body.history.length,0);
   if(!local){
    await page.locator('.diary-home-link').click();await send('fail synthetic');await page.getByRole('alert').filter({hasText:'Synthetic unavailable'}).waitFor();
    assert.equal(await page.locator('#diary-draft').inputValue(),'');assert.equal(await page.locator('.diary-conversation [data-role=user]').count(),3);
    await page.locator('#diary-draft').fill('');await page.locator('.diary-home-link').click();
    await page.getByRole('button',{name:'Add files and tools'}).click();await page.getByRole('checkbox',{name:'Extra attachments & tools'}).click();await page.getByText('Manage attachments (0)',{exact:true}).waitFor();await page.keyboard.press('Escape');
    await send('extras synthetic');await page.waitForFunction(()=>document.querySelector('.diary-conversation')?.getAttribute('aria-busy')==='false');
    const scope=fixture.requests.filter(r=>r.body.spaceId==='diary-extras').at(-1).body.sessionId;
    await page.locator('.diary-home-link').click();await send('extras again synthetic');await page.waitForFunction(()=>document.querySelector('.diary-conversation')?.getAttribute('aria-busy')==='false');
    assert.equal(fixture.requests.filter(r=>r.body.spaceId==='diary-extras').at(-1).body.sessionId,scope);
    const count=fixture.requests.filter(r=>r.body.spaceId==='diary').length;
    await page.locator('.diary-home-link').click();await send('cancel synthetic');await page.getByRole('button',{name:'Cancel optional context'}).click();await page.getByRole('alert').filter({hasText:'cancelled'}).waitFor();
    assert.equal(await page.locator('#diary-draft').inputValue(),'cancel synthetic');assert.equal(fixture.requests.filter(r=>r.body.spaceId==='diary').length,count);
   }
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${local?'browser-local':'server-backed'} Diary landing/day/history/date/navigation/layout${local?'':'/failure/cancellation/extras scope'}`);
  }
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
