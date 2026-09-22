// Actual rendered approval cards; APIs and writes remain memory-only fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const args=JSON.stringify({path:'Synthetic/'+ 'long-path-'.repeat(35),content:'BEGIN_FULL_ARGUMENTS\n'+('Synthetic proposed content with full disclosure.\n'.repeat(45))+'END_FULL_ARGUMENTS'});
(async()=>{
 const fixture=createFixture(31333);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 for(const [width,height] of [[320,568],[375,667],[390,360],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({theme,material})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:material',material);},{theme,material:process.env.QA_MATERIAL||'soft'});
  await page.route('**/api/chats/*/context',r=>r.fulfill({json:{project:{id:'synthetic-approval-context',name:'Synthetic',model:'synthetic',files:[],assets:[],toolboxes:['core']}}}));
  const decisions=[];let fail=true;
  await page.route('**/api/tool-approvals/*',r=>{decisions.push(r.request().postDataJSON().decision);return r.fulfill(fail?{status:503,json:{error:'Synthetic decision unavailable; retry.'}}:{json:{ok:true}});});
  const previousRequests=fixture.requests.length;
  await page.goto('http://localhost:31333');await page.getByPlaceholder('Message noevia…').fill('live synthetic');await page.getByRole('button',{name:'Send',exact:true}).click();
  for(let i=0;fixture.requests.length===previousRequests&&i<100;i++)await page.waitForTimeout(20);
  await page.waitForTimeout(100);
  const reach=async el=>{await el.scrollIntoViewIfNeeded();assert.ok(await el.evaluate(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&e.contains(document.elementFromPoint(x,y));}),`${width} ${theme} control reachable`);};
  for(const [index,decision,label] of [[0,'approve','Allow once'],[1,'deny','Decline'],[2,'approve_all','Allow for this chat']]){
   fixture.liveEvent({type:'tool_pending',index:0,id:'synthetic-'+index,name:'synthetic_write',args});
   const card=page.locator('.tool-approval');await card.waitFor();
   assert.equal(await card.locator('pre').textContent(),JSON.stringify(JSON.parse(args),null,1));
   assert.ok(await card.locator('pre').evaluate(e=>e.clientHeight>=e.scrollHeight-1),'Full arguments have no clipping or nested scroll');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
   assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth),'Card fits');
   for(const name of ['Allow once','Decline','Allow for this chat']){const button=card.getByRole('button',{name,exact:true});await reach(button);assert.ok(await button.evaluate(e=>e.getBoundingClientRect().height>=44),'Approval touch target at least 44px');}
   if(index===0){
    await reach(card.getByRole('button',{name:label,exact:true}));await card.getByRole('button',{name:label,exact:true}).click();
    await card.getByText('Synthetic decision unavailable; retry.').waitFor();fail=false;
   }
   await reach(card.getByRole('button',{name:label,exact:true}));
   await page.screenshot({path:`/tmp/noevia-approval-${width}-${theme}-${decision}.png`});
   await card.getByRole('button',{name:label,exact:true}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.tool-approval button')].every(b=>b.disabled));
   fixture.liveEvent({type:'tool_result',index:0,name:'synthetic_write',text:decision==='deny'?'Declined by user.':'Synthetic write accepted.',denied:decision==='deny'});
   await card.waitFor({state:'detached'});
  }
  assert.deepEqual(decisions,['approve','approve','deny','approve_all']);fixture.finishLive();await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS full mobile approval arguments, all three decisions, failure/retry, six viewports including keyboard height, both themes; synthetic writes only.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
