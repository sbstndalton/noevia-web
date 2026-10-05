// Synthetic APIs only. Chat replies list every tool call under the thinking block.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31258);await fixture.listen();
 const browser=await chromium.launch({headless:true,...(process.env.QA_CHROME_PATH?{executablePath:process.env.QA_CHROME_PATH}:{channel:'chrome'})});const errors=[];
 try{
  for(const [width,theme] of [[375,'light'],[768,'dark'],[1440,'light'],[1440,'dark']]){
   const page=await browser.newPage({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   await page.goto('http://localhost:31258');
   await page.getByRole('textbox',{name:'Message',exact:true}).fill('tools chat synthetic');await page.keyboard.press('Enter');
   await page.getByText('Synthetic answer after tools',{exact:true}).waitFor();
   // Thinking is labelled with how long it took, measured as it streamed.
   if(width===1440&&theme==='light'){
    await page.getByRole('textbox',{name:'Message',exact:true}).fill('slow thinking synthetic');await page.keyboard.press('Enter');
    await page.getByText('Synthetic considered answer',{exact:true}).waitFor();
    const label=(await page.locator('.thinking-block > summary').last().innerText()).trim();
    assert.match(label,/^Thought for [23]s$/,`thinking time: ${label}`);
    await page.getByRole('button',{name:'New chat',exact:true}).first().click();
    await page.getByRole('textbox',{name:'Message',exact:true}).fill('tools chat synthetic');await page.keyboard.press('Enter');
    await page.getByText('Synthetic answer after tools',{exact:true}).waitFor();
   }
   const list=page.locator('.msg .tool-calls, .tool-calls').last();
   await list.waitFor();
   assert.equal(await list.evaluate(el=>el.open),false,'finished tool list should be collapsed');
   assert.equal((await list.locator(':scope > summary').innerText()).trim(),'2 tool calls · 1 declined');
   await list.locator(':scope > summary').click();
   const items=list.locator('.tool-call');assert.equal(await items.count(),2);
   assert.equal(await items.nth(0).locator('.tool-call-name').innerText(),'project_search');
   assert.match(await items.nth(0).locator('.tool-call-preview').innerText(),/Found 2 synthetic matches/);
   assert.ok(await items.nth(1).evaluate(el=>el.classList.contains('is-declined')));
   await items.nth(0).locator('summary').click();
   assert.match(await items.nth(0).locator('pre').first().innerText(),/"query": "synthetic"/);
   assert.match(await items.nth(0).locator('pre').nth(1).innerText(),/Found 2 synthetic matches in notes.md/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
   await page.screenshot({path:`${process.env.QA_SCREENSHOTS||'/tmp'}/noevia-tool-calls-${width}-${theme}.png`});
   // The approval card for a pending write offers exactly the three actions; each sends its decision, and
   // the chip that follows is 'declined' only when the server marks the result declined.
   const decisions=[];
   await page.route('**/api/tool-approvals/*',r=>{decisions.push(r.request().postDataJSON().decision);return r.fulfill({json:{ok:true}});});
   const before=fixture.requests.length;
   await page.getByRole('textbox',{name:'Message',exact:true}).fill('live synthetic');await page.keyboard.press('Enter');
   for(let i=0;fixture.requests.length===before&&i<100;i++)await page.waitForTimeout(20);
   for(const [index,decision,label] of [[0,'approve','Allow once'],[1,'deny','Decline'],[2,'approve_all','Allow for this chat']]){
    fixture.liveEvent({type:'tool_pending',index:0,id:'synthetic-'+index,name:'synthetic_write',args:'{"path":"a.md"}'});
    const card=page.locator('.tool-approval');await card.waitFor();
    assert.deepEqual(await card.getByRole('button').allInnerTexts(),['Allow once','Decline','Allow for this chat'],`approval actions at ${width} ${theme}`);
    await card.getByRole('button',{name:label,exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.tool-approval button')].every(b=>b.disabled));
    fixture.liveEvent({type:'tool_result',index:0,name:'synthetic_write',text:decision==='deny'?'ERROR: the user declined this action.':'Synthetic write accepted.',...(decision==='deny'?{declined:true}:{})});
    await card.waitFor({state:'detached'});
   }
   assert.deepEqual(decisions,['approve','deny','approve_all']);
   fixture.finishLive();
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS tool calls: one collapsible list per reply, name and result per call, declined state, expandable arguments/result, the approval card with all three actions (Allow once, Decline, Allow for this chat) sending their decisions, 375/768/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
