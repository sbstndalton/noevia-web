// Synthetic APIs only. The footer's /api/stats poll is fixed at a stale
// value forever, so any change in the displayed rate can only have come from
// the per-round SSE 'usage' event — proving the footer no longer waits on the
// next poll tick to reflect a reply that already finished.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31257);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage();
  await page.goto('http://localhost:31257');
  const rate=()=>page.locator('.stats-bar .stats-value').first().innerText();
  await page.getByRole('region',{name:'Inference details'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.stats-bar .stats-value')?.textContent==='11.0');
  assert.equal(await rate(),'11.0','footer starts from the polled engine-wide snapshot');
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('live tokens synthetic');
  await page.keyboard.press('Enter');
  await page.getByText('Synthetic streamed reply',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.stats-bar .stats-value')?.textContent==='77.0',{timeout:1000});
  assert.equal(await rate(),'77.0','footer reflects the reply\'s own usage event, not the never-changing poll');
  console.log('PASS footer tokens/s updates from the live SSE usage event instead of waiting on the next poll tick');
 }catch(e){
  for(const p of browser.contexts().flatMap(c=>c.pages()))console.error(await p.locator('body').innerText().catch(()=>''));
  throw e;
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
