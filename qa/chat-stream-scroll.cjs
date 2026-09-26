// #387 (reopened): scrolling up while a reply is actively streaming must stick — not get
// force-pinned back to the bottom on every streamed chunk. Uses REAL input (a genuine mouse-wheel
// gesture, a real keyboard PageUp, and a scrollbar-drag-equivalent scrollTop write) against two
// synthetic slow-stream replies from the fixture, in the same SSE format the app consumes
// (see diary-fixture.cjs): 'long synthetic' (80 chunks / 60ms, ~4.8s) and the tighter
// 'fast token stream synthetic' (500 word-chunks / 12ms, ~6s — closer to a fast local model's
// per-token cadence, to give the race the best chance of showing up). A JS-dispatched WheelEvent
// never scrolls a real page, so it is deliberately NOT used here — that was the suspected
// false-positive vector for the reopen.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');

async function distFromBottom(page){
  return page.locator('.transcript').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
}

async function newChat(page){
  // A full page.reload() mid-stream hits a chat URL the fixture has no history for and never
  // re-renders the composer, so use the sidebar's own "New chat" control instead.
  const btn=page.getByTitle('New chat',{exact:true}).first();
  if(await btn.count())await btn.click();
  const box=page.getByRole('textbox',{name:'Message',exact:true});
  await box.waitFor();
  return box;
}

async function runTrial(page,message,gesture){
  const box=await newChat(page);
  await box.fill(message);
  await box.press('Enter');
  // Let a handful of chunks land so the transcript is tall enough to scroll within.
  await page.waitForFunction(()=>{
    const el=document.querySelector('.transcript');
    return el && el.scrollHeight>el.clientHeight+400;
  },null,{timeout:5000});
  await gesture(page);
  const t0=await distFromBottom(page);
  await page.waitForTimeout(150);
  const t150=await distFromBottom(page);
  await page.waitForTimeout(850);
  const t1000=await distFromBottom(page);
  await page.waitForTimeout(1000);
  const t2000=await distFromBottom(page);
  // Let the stream finish before the next trial starts a new chat.
  await page.getByTitle('Stop generating').waitFor({state:'detached',timeout:10000}).catch(()=>{});
  return {t0,t150,t1000,t2000};
}

async function runControl(page,message){
  const box=await newChat(page);
  await box.fill(message);
  await box.press('Enter');
  await page.getByTitle('Stop generating').waitFor({state:'detached',timeout:10000});
  await page.locator('.transcript').hover();
  await page.mouse.wheel(0,-1500);
  await page.waitForTimeout(300);
  return distFromBottom(page);
}

const THRESHOLD=48; // FOLLOW_THRESHOLD_PX
const stuckPinned=(r)=>r.t150<THRESHOLD&&r.t1000<THRESHOLD&&r.t2000<THRESHOLD;

(async()=>{
 const fixture=createFixture(31393);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:31393');

  const results={};
  for(const message of ['long synthetic','fast token stream synthetic']){
    console.log(`=== stream: "${message}" ===`);
    results[message]={};

    console.log('-- real mouse wheel scroll-up while streaming --');
    results[message].wheel=await runTrial(page,message,async(p)=>{
      await p.locator('.transcript').hover();
      await p.mouse.wheel(0,-1500);
    });
    console.log(JSON.stringify(results[message].wheel));

    console.log('-- keyboard PageUp while streaming --');
    results[message].keyboard=await runTrial(page,message,async(p)=>{
      await p.locator('.transcript').evaluate(el=>el.focus());
      await p.keyboard.press('PageUp');
    });
    console.log(JSON.stringify(results[message].keyboard));

    console.log('-- scrollbar-drag-equivalent scrollTop write while streaming --');
    results[message].drag=await runTrial(page,message,async(p)=>{
      await p.locator('.transcript').evaluate(el=>{ el.scrollTop=0; });
    });
    console.log(JSON.stringify(results[message].drag));
  }

  console.log('=== control: real mouse wheel scroll-up AFTER the stream has finished ===');
  const controlDist=await runControl(page,'long synthetic');
  console.log('control (post-stream) distFromBottom after 300ms:',controlDist);

  assert.deepEqual(errors,[]);

  let reproduced=false;
  for(const [message,byGesture] of Object.entries(results)){
    for(const [gesture,r] of Object.entries(byGesture)){
      const stuck=stuckPinned(r);
      console.log(`${message} / ${gesture}: ${JSON.stringify(r)} stuck=${stuck}`);
      if(stuck)reproduced=true;
    }
  }

  if(reproduced){
    console.log('REPRODUCED: a real user gesture during streaming was force-pinned back to the bottom.');
    process.exitCode=1; // non-zero on the buggy build; the fixed build should print NOT REPRODUCED below
  } else {
    console.log('NOT REPRODUCED: every real gesture held its scroll position away from the bottom during streaming.');
  }
  assert.ok(controlDist>THRESHOLD,'control: a post-stream scroll-up must still hold (this is the already-fixed #394 case)');
  console.log(reproduced?'FAIL #387 still reproduces with real input':'PASS #387 does not reproduce with real input; scroll-up during streaming holds');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
