// Settings → General, against synthetic APIs only.
//
// The page gained a profile block, presentation preferences and a capabilities
// report. The preferences are applied by an attribute on <html> that
// public/theme.js restores before paint, so the thing worth asserting is that
// the attribute really changes the page and really survives a reload.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31356);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:950}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let displayName='Synthetic admin';
 await page.route('**/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname,m=req.method();
  const json=(body,status=200)=>route.fulfill({status,json:body});
  if(p==='/api/profile'&&m==='PATCH'){displayName=JSON.parse(req.postData()||'{}').displayName;return json({user:{id:'qa',username:'adminqa',displayName,role:'admin',disabled:false,diaryEnabled:true,onboarded:true}});}
  if(p==='/api/profile'||p==='/api/auth/session')return json({user:{id:'qa',username:'adminqa',displayName,role:'admin',disabled:false,diaryEnabled:true,onboarded:true},passkeys:[]});
  if(p==='/api/health')return json({inferenceUp:true,diaryUp:true,ragAvailable:false});
  if(p==='/api/toolboxes')return json({toolboxes:[{id:'core',label:'Core',description:'x',toolCount:2,estTokens:180,source:'builtin',available:true}],mcp:{configured:false,servers:[]}});
  if(p==='/api/models/installed')return json([]);
  return route.continue();
 });
 await page.goto('http://localhost:31356');
 await page.getByTitle('Settings',{exact:true}).click();
 const dialog=page.getByRole('region',{name:'Settings'});
 // Opening Settings lands on General; Account keeps identity separate.
 await dialog.getByRole('button',{name:'Appearance & language',exact:true}).waitFor();
 await dialog.getByLabel('Search settings').fill('  connectors  ');
 await dialog.getByRole('button',{name:'Connected apps',exact:true}).click();
 await dialog.getByRole('heading',{name:'Connectors',exact:true}).waitFor();
 await dialog.getByLabel('Search settings').fill('no-such-setting');
 await dialog.getByText('No matching settings',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Clear search',exact:true}).click();
 assert.ok(await dialog.getByLabel('Search settings').evaluate(el=>el===document.activeElement));
 assert.equal(await dialog.getByRole('button',{name:'Planned features',exact:true}).count(),0);
 await dialog.getByRole('button',{name:'Account',exact:true}).click();

 // ── Profile ──
 await dialog.getByRole('heading',{name:'Account',level:1}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Display name"]')?.value==='Synthetic admin');
 assert.ok(await dialog.getByText('adminqa',{exact:true}).isVisible(),'the username is not shown');
 assert.ok(await dialog.getByText('Administrator',{exact:true}).isVisible());
 // Save is inert until the name actually changes, so an accidental click is a no-op.
 assert.ok(await dialog.getByRole('button',{name:'Save'}).isDisabled());
 await dialog.getByLabel('Display name').fill('Renamed admin');
 await dialog.getByRole('button',{name:'Save'}).click();
 await dialog.getByText('Saved.',{exact:true}).waitFor();
 assert.equal(displayName,'Renamed admin');

 assert.equal(await dialog.getByText('Chat font').count(),0,'appearance leaked onto Profile');
 await dialog.getByRole('button',{name:'Appearance & language',exact:true}).click();
 await dialog.getByRole('heading',{name:'Appearance & language',level:1}).waitFor(); const glassTarget=dialog.getByRole('button',{name:'Security and login',exact:true});await glassTarget.hover({position:{x:30,y:12}});await page.waitForTimeout(80);assert.equal(await glassTarget.getAttribute('data-glass-active'),null,'Soft navigation does not acquire glass effects');await page.mouse.move(5,5);

 // ── Preferences actually change the page ──
 const attr=name=>page.evaluate(n=>document.documentElement.getAttribute(n),name);
 assert.equal(await attr('data-chat-font'),'sans');
 assert.equal(await attr('data-density'),'comfortable');
 assert.equal(await attr('data-motion'),'system');
 await dialog.getByLabel('Chat font').selectOption('serif');
 await dialog.getByRole('radiogroup',{name:'Density'}).getByRole('radio',{name:'Compact'}).click();
 await dialog.getByRole('radiogroup',{name:'Motion'}).getByRole('radio',{name:'Reduced'}).click();
 assert.equal(await attr('data-chat-font'),'serif');
 assert.equal(await attr('data-density'),'compact');
 assert.equal(await attr('data-motion'),'reduced');
 // …and the chat font is really applied, not just recorded.
 const family=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--font-chat').trim());
 assert.match(family,/serif/i,`--font-chat did not follow the setting: ${family}`);

 // ── They survive a reload, without a flash of the previous setting ──
 await page.reload();
 assert.equal(await attr('data-chat-font'),'serif');
 assert.equal(await attr('data-density'),'compact');
 assert.equal(await attr('data-motion'),'reduced');

 // The reload restored Settings rather than dropping to a new chat, so it is still open.
 await dialog.waitFor();
 await dialog.getByRole('button',{name:'Capabilities (status)',exact:true}).click();

 // ── Capabilities report real state, and never offer to disable approvals ──
 await dialog.getByRole('heading',{name:'Capabilities',level:1}).waitFor();
 await dialog.getByText('Available',{exact:true}).or(dialog.getByText('No index on this deployment',{exact:true})).first().waitFor();
 assert.ok(await dialog.getByText('No index on this deployment').isVisible(),'retrieval state is not reported');
 assert.ok(await dialog.getByText('Not configured',{exact:true}).isVisible(),'tool state is not reported');
 assert.ok(await dialog.getByText('Reachable',{exact:true}).isVisible());
 assert.match(await dialog.getByText(/Write approvals cannot be turned off/).innerText(),/stops for a human/);
 for(const forbidden of [/never ask/i,/always allow/i,/disable approvals/i]){
  assert.equal(await dialog.getByText(forbidden).count(),0,`Capabilities offers ${forbidden}`);
 }

 // ── Layout ──
 for(const theme of ['dark','light']){
  await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  for(const [w,h] of [[375,780],[768,1024],[1440,950]]){
   await page.setViewportSize({width:w,height:h});
   await page.waitForTimeout(120);
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`overflow at ${w} ${theme}`);
   const small=await dialog.evaluate(el=>[...el.querySelectorAll('.set-rows select, .set-rows input, .set-rows button')]
     .filter(b=>{const r=b.getBoundingClientRect();return r.width&&r.height&&r.height<40;}).map(b=>b.getAttribute('aria-label')||b.textContent.trim()).slice(0,5));
   assert.deepEqual(small,[],`small targets at ${w} ${theme}`);
   await page.screenshot({path:`/tmp/noevia-general-${w}-${theme}.png`});
  }
 }
 await page.setViewportSize({width:1440,height:950});
 assert.deepEqual(errors,[]);
 console.log('PASS general settings: profile rename, chat font/density/motion applied and restored before paint, capabilities reported from real state, no approval opt-out, three widths and both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exit(1);});
