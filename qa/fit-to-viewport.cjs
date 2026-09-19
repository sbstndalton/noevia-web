// Shrink-to-fit (user review, 2026-09-19): a page or menu that is only slightly too tall is
// scaled just enough to fit, so a phone never scrolls for one last line; long lists still scroll.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-shots';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
(async()=>{
 const fixture=createFixture(31379);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 const report=[];
 try{
  for(const [w,h] of [[390,844],[375,667],[320,568]]){
   const page=await browser.newPage({viewport:{width:w,height:h},hasTouch:true,isMobile:true,userAgent:IPHONE});page.on('pageerror',e=>errors.push(e.message));
   const chat=(id)=>({id,title:`Synthetic ${id}`,updatedAt:1000,messages:[]});
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[],freeChats:Array.from({length:40},(_,i)=>chat(`recent${i}`))}}));
   await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
   await page.goto('http://localhost:31379');await page.getByPlaceholder('Message noevia…').waitFor();
   const state=sel=>page.evaluate(s=>{const a=document.querySelector(s);const z=[...a.children].map(c=>c.style.zoom).find(Boolean)||'1';return {over:a.scrollHeight-a.clientHeight,zoom:+z};},sel);
   const open=()=>page.getByRole('button',{name:'Open navigation',exact:true}).tap();
   await open();await page.getByRole('dialog',{name:'Navigation'}).getByRole('button',{name:'Code',exact:true}).tap();
   for(const p of ['New task','Pull requests','Scheduled','Explore']){
    if(p!=='New task'){await open();await page.getByRole('dialog',{name:'Navigation'}).getByRole('button',{name:p}).tap();}
    await page.locator('.coding-header',{hasText:p}).waitFor();await page.waitForTimeout(120);
    const s=await state('.coding-content');report.push(`${w}x${h} ${p}: overflow ${s.over}px zoom ${s.zoom}`);
    assert.ok(s.over<=1||s.zoom===1,`${w}x${h} ${p}: either fits or is genuinely long ${JSON.stringify(s)}`);
    if(s.zoom<1)assert.ok(s.zoom>=0.82,`${p}: never shrinks past 0.82`);
    await page.screenshot({path:`${out}/fit-${w}x${h}-${p.replace(/ /g,'-')}.png`});
   }
   // A long chat list keeps its size and scrolls.
   await open();await page.getByRole('dialog',{name:'Navigation'}).getByRole('button',{name:'Chat',exact:true}).tap();await open();
   const side=await state('.sidebar.pane');assert.ok(side.over>100&&side.zoom===1,`long list scrolls at full size ${JSON.stringify(side)}`);
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log(report.join('\n'));console.log('PASS fit-to-viewport');
 }finally{await browser.close();await fixture.close?.();}
})().catch(e=>{console.error(e);process.exit(1);});
