// Two devices answer in the same chat; neither transcript is lost. Synthetic APIs; the history
// endpoint below follows the server's revision contract (409 with the current copy on a stale base).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31398);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  let stored=[{role:'user',content:'Shared question'},{role:'assistant',content:'Shared answer'}];
  const rev=h=>crypto.createHash('sha256').update(JSON.stringify(h)).digest('hex');
  const chat={id:'c-shared',title:'Shared chat',updatedAt:Date.now(),preview:'Shared question'};
  const device=async()=>{
   const ctx=await browser.newContext({viewport:{width:1280,height:900}});const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[],freeChats:[chat]}}));
   await page.route('**/api/chats/c-shared/history',async r=>{
     if(r.request().method()==='GET')return r.fulfill({json:{history:stored,revision:rev(stored)}});
     const body=r.request().postDataJSON();
     if(body.baseRevision&&body.baseRevision!==rev(stored))return r.fulfill({status:409,json:{error:'changed',history:stored,revision:rev(stored)}});
     stored=body.history;return r.fulfill({json:{ok:true,revision:rev(stored)}});
   });
   await page.goto('http://localhost:31398');await page.getByPlaceholder('Message noevia…').waitFor();
   await page.locator('.sidebar').getByText('Shared chat').first().click();
   await page.getByText('Shared answer').waitFor();
   return page;
  };
  const laptop=await device(), phone=await device();
  const send=async(page,text)=>{const box=page.getByRole('textbox',{name:'Message',exact:true});await box.fill(text);await box.press('Enter');};
  await send(laptop,'Laptop follow-up');
  for(let i=0;i<100&&!stored.some(m=>m.content==='Laptop follow-up'&&stored.length>=4);i++)await laptop.waitForTimeout(50);
  assert.ok(stored.some(m=>m.content==='Laptop follow-up'),'laptop save never landed');
  await send(phone,'Phone follow-up');
  for(let i=0;i<100&&!stored.some(m=>m.content==='Phone follow-up');i++)await phone.waitForTimeout(50);
  const contents=stored.map(m=>m.content);
  assert.ok(contents.includes('Laptop follow-up')&&contents.includes('Phone follow-up'),`a device's turn was lost: ${JSON.stringify(contents)}`);
  assert.equal(contents.filter(c=>c==='Shared question').length,1,'shared start duplicated');
  await phone.getByText('Laptop follow-up').waitFor({timeout:3000});
  assert.deepEqual(errors,[]);
  console.log('PASS two-device history: concurrent replies from two devices are both kept (409 → merge → save), and the stale device shows the merged chat.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
