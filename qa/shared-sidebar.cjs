// One sidebar for Chat and Code (user review, 2026-09-19): Code used its own old-style sidebar
// with the mode switch outside the rail and a toggle out of line; leaving Settings dropped you
// into Chat; New chat scrolled away; the collapsed rail named nothing on hover.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-shots';
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
(async()=>{
 const fixture=createFixture(31378);await fixture.listen();
 const browser=await browser_();async function browser_(){return chromium.launch({headless:true,channel:'chrome'});}
 const errors=[];
 const setup=async(opts)=>{const page=await browser.newPage(opts);page.on('pageerror',e=>errors.push(e.message));
  const chat=(id,pinned=false)=>({id,title:`Synthetic ${id}`,updatedAt:1000,pinned,messages:[]});
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:Array.from({length:6},(_,i)=>({id:`p${i}`,name:`Synthetic project ${i}`,updatedAt:1000,files:[],chats:[]})),freeChats:Array.from({length:30},(_,i)=>chat(`recent${i}`))}}));
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  await page.route('**/api/plugins/directory*',r=>{const kind=new URL(r.request().url()).searchParams.get('kind');r.fulfill({json:{source:{label:'fixture',home:'https://example.com'},items:kind==='skills'?[{id:'pdf',name:'Pdf',publisher:'Anthropic',description:'',version:'',url:'https://github.com/anthropics/skills',remote:false}]:[{id:'io.github.x/fixture',name:'fixture-server',publisher:'io.github.x',description:'A synthetic MCP server',version:'1.0.0',url:'https://github.com/x/fixture',remote:true}]}});});
  await page.goto('http://localhost:31378');await page.getByPlaceholder('Message noevia…').waitFor();return page;};
 try{
  // ── Desktop ──
  for(const theme of ['light','dark']){
  const page=await setup({viewport:{width:1280,height:800}});
  await page.evaluate(t=>{localStorage.setItem('cowork-theme',t);localStorage.setItem('noevia:sidebar-collapsed','0');},theme);await page.reload();await page.getByPlaceholder('Message noevia…').waitFor();
  const side=page.locator('.sidebar.pane');
  // Sticky New chat: scroll the list, the button stays at the top of the rail.
  await side.evaluate(el=>el.scrollTop=600);await page.waitForTimeout(50);
  const stuck=await page.evaluate(()=>{const s=document.querySelector('.sidebar.pane').getBoundingClientRect(),b=document.querySelector('.new-chat-btn').getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {top:b.top-s.top,visible:!!hit?.closest('.new-chat-btn')};});
  assert.ok(stuck.top>=0&&stuck.top<24&&stuck.visible,`New chat floats over the scrolled list ${JSON.stringify(stuck)}`);
  await page.screenshot({path:`${out}/shared-${theme}-sticky.png`});
  await side.evaluate(el=>el.scrollTop=0);
  // Plugins is a real page with Google Drive and the directory.
  await page.getByRole('button',{name:'Plugins',exact:true}).click();
  await page.getByRole('heading',{name:'Plugins'}).waitFor();
  await page.getByRole('button',{name:'Google Drive'}).waitFor();
  await page.getByRole('radio',{name:'MCP servers'}).click();await page.getByText('fixture-server').waitFor();
  await page.getByRole('radio',{name:'Skills',exact:true}).click();await page.getByText('Pdf',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/shared-${theme}-plugins.png`});
  // Code mode uses the same sidebar element.
  const before=await side.elementHandle();
  await page.getByRole('button',{name:'Code',exact:true}).click();
  await page.getByRole('heading',{name:'What should we build next?'}).waitFor();
  assert.equal(await page.locator('.coding-sidebar').count(),0,'no second, old-style sidebar');
  assert.ok(await before.evaluate(el=>el.isConnected&&el.dataset.mode==='code'),'the same sidebar switched to Code');
  assert.equal(await page.locator('.shell-sidebar-head .app-mode-switch').count(),1,'mode switch sits in the sidebar header');
  await page.getByRole('button',{name:'Pull requests'}).click();await page.locator('.coding-header',{hasText:'Pull requests'}).waitFor();
  await page.screenshot({path:`${out}/shared-${theme}-code.png`});
  // Settings from Code returns to Code.
  await page.locator('.side-footer .account-trigger').click();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('region',{name:'Settings'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Connectors'}).count(),0,'Connectors moved to Plugins');
  await page.getByRole('button',{name:'Close settings'}).click();await page.getByRole('region',{name:'Settings'}).waitFor({state:'detached'});
  assert.ok(await page.locator('.coding-header',{hasText:'Pull requests'}).isVisible(),'closing Settings returns to Code');
  // Collapsed in Code: the toggle lines up with the icons below it, and the rail names things.
  await page.getByRole('button',{name:'Collapse navigation'}).click();await page.waitForTimeout(350);
  const cx=await page.evaluate(()=>[...document.querySelectorAll('.sidebar.pane :is(.side-expand, .new-chat-btn, .side-nav .nav-item, .account-trigger)')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return Math.round(r.left+r.width/2);}));
  assert.ok(Math.max(...cx)-Math.min(...cx)<=1,`collapsed rail is one centred column ${cx}`);
  await page.getByRole('button',{name:'Scheduled'}).hover();
  const tip=page.getByRole('tooltip');await tip.waitFor();assert.equal(await tip.textContent(),'Scheduled');
  await page.screenshot({path:`${out}/shared-${theme}-collapsed-tip.png`});
  await page.getByRole('button',{name:'Chat',exact:true}).click();await page.getByRole('heading',{name:'Plugins'}).waitFor();
  await page.getByRole('button',{name:'Projects',exact:true}).hover();await page.waitForFunction(()=>document.querySelector('.rail-tip')?.textContent==='Projects');
  await page.getByRole('button',{name:'Expand navigation'}).click();
  await page.close();}
  // ── iPhone ──
  for(const [w,h] of [[390,844],[320,568]]){
  const page=await setup({viewport:{width:w,height:h},hasTouch:true,isMobile:true,userAgent:IPHONE});
  const open=()=>page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await open();const drawer=page.getByRole('dialog',{name:'Navigation'});await drawer.waitFor();
  await drawer.getByRole('button',{name:'Code',exact:true}).click();await drawer.waitFor({state:'detached'});
  await page.getByRole('heading',{name:'What should we build next?'}).waitFor();
  await open();await drawer.waitFor();await drawer.getByRole('button',{name:'Explore'}).click();await drawer.waitFor({state:'detached'});
  await page.locator('.coding-header',{hasText:'Explore'}).waitFor();
  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert.ok(fits,`${w}: no sideways scroll in Code`);
  await page.screenshot({path:`${out}/shared-phone-${w}-code.png`});
  await open();await drawer.getByRole('button',{name:'Chat',exact:true}).click();await drawer.waitFor({state:'detached'});
  await page.getByPlaceholder('Message noevia…').waitFor();
  await page.close();}
  assert.deepEqual(errors,[]);
  console.log('shared-sidebar: all checks passed');
 }finally{await browser.close();await fixture.close?.();}
})().catch(e=>{console.error(e);process.exit(1);});
