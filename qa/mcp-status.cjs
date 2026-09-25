// Settings → Status, the "Connected tools" card, against synthetic APIs only.
//
// Exists because an unconfigured MCP deployment and a broken one used to look
// identical: an empty server list and the word "Degraded"/"Not configured" with
// nothing naming what to set. On 2026-09-15 the live Compose file had lost
// MCP_SERVERS and this card was the only surface that could have said so.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31347);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:950}});
 await page.emulateMedia({reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mcp={configured:false,servers:[]};
 await page.route('**/api/**',route=>{
  const req=route.request(),p=new URL(req.url()).pathname;
  const json=(body,status=200)=>route.fulfill({status,json:body});
  if(p==='/api/profile'||p==='/api/auth/session')return json({user:{id:'qa',username:'admin',displayName:'Synthetic admin',role:'admin',diaryEnabled:false,onboarded:true},passkeys:[]});
  if(p==='/api/toolboxes')return json({toolboxes:[{id:'core',label:'Core',tools:[],available:true}],mcp});
  if(p==='/api/models/installed')return json([]);
  return route.continue();
 });
 await page.goto('http://localhost:31347');
 await page.getByTitle('Settings',{exact:true}).click();
 const dialog=page.getByRole('region',{name:'Settings'});
 await dialog.getByRole('button',{name:'Service status'}).click();

 // Unconfigured: the heading names the variable, and the note explains that a
 // deployment which used to show tools has probably lost it.
 await dialog.getByRole('heading',{name:/Connected tools · Not configured — set MCP_SERVERS/}).waitFor();
 const note=dialog.getByText(/No MCP server is configured/);
 await note.waitFor();
 assert.match(await note.innerText(),/MCP_SERVERS/);
 assert.match(await note.innerText(),/Compose file has most likely lost that variable/);

 // Both themes at the three widths: no horizontal overflow, note stays visible.
 for(const theme of ['dark','light']){
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  for(const [w,h] of [[375,760],[768,1024],[1440,950]]){
   await page.setViewportSize({width:w,height:h});
   await page.waitForFunction(()=>true);
   assert.ok(await note.isVisible(),`note hidden at ${w} ${theme}`);
   const over=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);
   assert.ok(!over,`horizontal overflow at ${w} ${theme}`);
  }
 }
 await page.setViewportSize({width:1440,height:950});

 // Configured and healthy: the variable prompt is gone and servers are listed.
 mcp={configured:true,servers:[{id:'nextcloud',auth:'nextcloud',error:null,discovered:160,checkedAt:Date.now()},
      {id:'tavily',auth:'bearer',error:null,discovered:5,checkedAt:Date.now()}]};
 await dialog.getByRole('button',{name:'Reload status'}).click();
 await dialog.getByRole('heading',{name:/Connected tools · Available/}).waitFor();
 assert.equal(await dialog.getByText(/No MCP server is configured/).count(),0);
 assert.ok(await dialog.getByText('160 tools discovered',{exact:false}).isVisible());

 // A configured server that cannot be reached is Unavailable, NOT "not configured".
 mcp={configured:true,servers:[{id:'nextcloud',auth:'nextcloud',error:'connect ECONNREFUSED',discovered:0,checkedAt:Date.now()}]};
 await dialog.getByRole('button',{name:'Reload status'}).click();
 await dialog.getByRole('heading',{name:/Connected tools · Unavailable/}).waitFor();
 assert.equal(await dialog.getByText(/No MCP server is configured/).count(),0);

 assert.deepEqual(errors,[]);
 console.log('PASS mcp status: unconfigured names MCP_SERVERS with a cause, both themes at 375/768/1440 without overflow, configured lists servers, unreachable stays distinct from unconfigured.');
 } finally { await browser.close(); await fixture.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
