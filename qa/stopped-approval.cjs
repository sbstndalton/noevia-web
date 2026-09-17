// Bug hunt (area a): stopping a reply while a write waits for approval must not persist a live-looking
// approval card; after reload the call reads "not run" with no decision buttons. Synthetic APIs only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31392);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  let saved=null;
  await page.route('**/api/chats/*/history',async r=>{if(r.request().method()==='POST'){saved=r.request().postDataJSON().history;return r.fulfill({json:{ok:true}});}return r.fulfill({json:saved||[]});});
  await page.goto('http://localhost:31392');
  const box=page.getByRole('textbox',{name:'Message',exact:true});await box.fill('pending write synthetic');await box.press('Enter');
  await page.getByRole('button',{name:'Allow once'}).waitFor();
  await page.getByTitle('Stop generating').click();
  await page.waitForFunction(()=>!document.querySelector('.tool-approval'),null,{timeout:5000}).catch(()=>{});
  for(let i=0;i<50&&!saved;i++)await page.waitForTimeout(50);
  const calls=(saved||[]).flatMap(m=>m.toolCalls||[]);
  assert.equal(calls.length,1,'the stopped call is kept in history');
  assert.notEqual(calls[0].status,'pending','a stopped approval must not be persisted as pending');
  assert.equal(calls[0].approvalId,undefined,'no stale approval id is persisted');
  assert.equal(await page.getByRole('button',{name:'Allow once'}).count(),0,'no decision buttons after stopping');
  const list=page.locator('.tool-calls').last();await list.locator(':scope > summary').click();
  assert.match(await list.locator(':scope > summary').innerText(),/1 not run/);
  if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/stopped-approval.png`});
  assert.deepEqual(errors,[]);
  console.log('PASS stopped approval: stop clears pending approvals before saving and shows the call as not run (loading old histories is covered by tests/tool-call-state.test.cjs).');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
