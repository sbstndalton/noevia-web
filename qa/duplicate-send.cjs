// Bug hunt (area a): two sends in the same tick must start one generation, not two.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31391);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const chats=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/chat'&&r.method()==='POST')chats.push(r.postDataJSON());});
  await page.goto('http://localhost:31391');
  const box=page.getByRole('textbox',{name:'Message',exact:true});await box.fill('synthetic double send');
  // Two Enter presses delivered in one task, before React can re-render the streaming state.
  await box.evaluate(el=>{for(let i=0;i<2;i++)el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  await page.waitForTimeout(1500);
  assert.equal(chats.length,1,`expected one /api/chat request, got ${chats.length}`);
  assert.deepEqual(errors,[]);
  console.log('PASS duplicate send: two same-tick sends start one generation.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
