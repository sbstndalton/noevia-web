// Bug hunt (area f): on short phones with the inference banner showing, a new chat must open with the
// whole composer row (add, model, thinking, send) visible and tappable, without scrolling.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const fixture=createFixture(31393);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,height] of [[320,568],[375,553],[390,600],[568,320]])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   await page.route('**/api/health',r=>r.fulfill({json:{inferenceUp:false,diaryUp:true}}));
   await page.goto('http://localhost:31393');
   await page.getByPlaceholder('Message noevia…').waitFor();await page.waitForTimeout(400);
   const blocked=await page.evaluate(()=>['[aria-label="Add files and tools"]','.send-btn','textarea'].map(sel=>{const el=document.querySelector(sel);if(!el)return `${sel} missing`;const b=el.getBoundingClientRect();const x=b.x+Math.min(b.width/2,20),y=b.y+b.height/2;return b.bottom<=innerHeight&&el.contains(document.elementFromPoint(x,y))?null:`${sel} at ${Math.round(b.top)}-${Math.round(b.bottom)} of ${innerHeight}`;}).filter(Boolean));
   if(shots)await page.screenshot({path:`${shots}/short-phone-${width}x${height}-${theme}.png`});
   assert.deepEqual(blocked,[],`${width}x${height} ${theme}: composer controls hidden`);
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS short phone composer: add, send and message box visible and tappable at 320x568, 375x553, 390x600, 568x320 with the inference banner, both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
