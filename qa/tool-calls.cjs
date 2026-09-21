// Synthetic APIs only. Chat replies list every tool call under the thinking block.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31258);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
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
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS tool calls: one collapsible list per reply, name and result per call, declined state, expandable arguments/result, 375/768/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
