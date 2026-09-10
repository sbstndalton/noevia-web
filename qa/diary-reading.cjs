// Synthetic saved record plus real incremental SSE; never accesses production.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31252);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:950},timezoneId:'America/New_York'});
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
  await page.route('**/api/diary/today?**',route=>route.fulfill({json:{todayLog:`## ${today}\n\nSynthetic saved summary`,standingSections:{}}}));
  await page.goto('http://localhost:31252');await page.getByRole('button',{name:'Diary',exact:true}).click();
  const send=async()=>{await page.locator('#diary-draft').fill('long synthetic');await page.getByRole('button',{name:'Send diary message'}).click();};
  for(const width of [1440,375]){
   await page.setViewportSize({width,height:950});await send();
   await page.waitForFunction(()=>document.querySelector('.diary-conversation')?.textContent.includes('paragraph 12.'));
   const scroll=page.locator('.diary-content-scroll');
   assert.equal(await page.locator('.diary-saved-record').getAttribute('open'),null);
   assert.equal(await page.getByText('Synthetic saved summary',{exact:true}).isVisible(),false);
   assert.ok(await scroll.evaluate(el=>el.scrollTop>0));
   const dock=await page.locator('.diary-composer-dock').boundingBox();
   await scroll.hover();await page.mouse.wheel(0,-100000);
   await page.waitForFunction(()=>document.querySelector('.diary-content-scroll').scrollTop===0);
   const current=await page.locator('.diary-conversation').innerText();
   await page.waitForFunction(previous=>document.querySelector('.diary-conversation').textContent.length>previous.length+1000,current);
   assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'new tokens must not move a reader who scrolled up');
   assert.deepEqual(await page.locator('.diary-composer-dock').boundingBox(),dock,'composer must stay in place');
   assert.ok(dock.y+dock.height<=950);
   await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
   await page.waitForFunction(()=>document.querySelector('.diary-conversation').getAttribute('aria-busy')==='false');
   assert.ok(await scroll.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<48),'following resumes at bottom');
   await page.locator('.diary-saved-record summary').click();await page.getByText('Synthetic saved summary',{exact:true}).waitFor();
   await page.locator('.diary-saved-record summary').click();
   if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/diary-reading-${width}.png`});
  }
  console.log('PASS saved summary disclosure, streaming scroll opt-out/resume and stationary composer at desktop/mobile widths');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
