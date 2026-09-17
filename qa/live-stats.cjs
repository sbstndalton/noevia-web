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
  // An engine that reports no rate between requests must not blank the last reported value.
  await page.route('**/api/stats',r=>r.fulfill({json:{up:true,tokensPerSecond:null,timeToFirstToken:null,inputTokens:null,outputTokens:null,inputTokensTotal:1,outputTokensTotal:1,requestCount:1,cpuPercent:null,gpuPercent:null,vramGb:null,memoryGb:null,mtp:[]}}));
  const polls=[];page.on('request',r=>{if(r.url().endsWith('/api/stats'))polls.push(1);});
  await page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,3200));
  assert.ok(polls.length>=1,'no poll happened');
  assert.equal(await rate(),'77.0','a null poll blanked the last reported rate');
  console.log('PASS footer tokens/s updates from the live SSE usage event instead of waiting on the next poll tick, and a null poll keeps the last value');
 }catch(e){
  for(const p of browser.contexts().flatMap(c=>c.pages()))console.error(await p.locator('body').innerText().catch(()=>''));
  throw e;
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
