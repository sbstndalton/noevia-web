// Phone drawer defects found live on d11cfac, against the synthetic fixture: the drawer opened
// from Diary rendered the icon rail; Diary/Plugins sat under a footer taller than the assumed
// 60px; rows scrolled past beneath the footer; a row's menu was clipped by the drawer.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-shots';
(async()=>{
 const fixture=createFixture(31377);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 for(const [w,h,touch] of [[500,761,false],[390,844,true],[375,667,true],[320,568,true]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:w,height:h},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  const chat=(id,pinned=false)=>({id,title:`Synthetic ${id}`,updatedAt:1000,pinned,messages:[]});
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:Array.from({length:3},(_,i)=>({id:`p${i}`,name:`Synthetic project ${i}`,updatedAt:1000,files:[],chats:[]})),freeChats:[chat('pinned',true),chat('pinned2',true),...Array.from({length:14},(_,i)=>chat(`recent${i}`))]}}));
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  await page.route('**/api/toolboxes',r=>r.fulfill({json:{toolboxes:[],mcp:{configured:true,discovered:176,servers:[{id:'a'},{id:'b'},{id:'c'}]}}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  const tag=`${w}x${h}-${theme}`;const open=()=>page.getByRole('button',{name:'Open navigation',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'Navigation'});
  const layout=()=>page.evaluate(()=>{const s=document.querySelector('.sidebar'),p=s.querySelector('.side-permanent').getBoundingClientRect(),f=s.querySelector('.side-footer').getBoundingClientRect(),b=s.getBoundingClientRect();
    const sticky=getComputedStyle(s.querySelector('.side-footer')).position==='sticky';
    return {sticky,overlap:p.bottom-f.top,gapBelowFooter:b.bottom-f.bottom,labels:[...s.querySelectorAll('.nav-name')].filter(n=>n.getBoundingClientRect().width>2).length,lists:s.querySelectorAll('.side-scroll').length&&getComputedStyle(s.querySelector('.side-scroll')).display!=='none'};});
  const check=async(label)=>{const l=await layout();
   assert.ok(l.labels>=2&&l.lists,`${tag} ${label}: drawer shows labels and lists ${JSON.stringify(l)}`);
   if(l.sticky){assert.ok(l.overlap<=1,`${tag} ${label}: Diary pane under the footer ${JSON.stringify(l)}`);assert.ok(l.gapBelowFooter<=1,`${tag} ${label}: rows show below the footer ${JSON.stringify(l)}`);}
   const plugins=page.getByRole('button',{name:'Plugins',exact:true});await plugins.scrollIntoViewIfNeeded();
   await plugins.evaluate((el,t)=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!el.contains(hit))throw Error(t+': Plugins covered by '+(hit?.className||hit?.tagName));},`${tag} ${label}`);};
  await open();await drawer.waitFor();await check('from chat');
  const opts=page.getByRole('button',{name:'Options for Synthetic recent7',exact:true});await opts.scrollIntoViewIfNeeded();
  const before=await page.locator('.sidebar').evaluate(el=>el.scrollTop);await opts.click();
  const menu=page.getByRole('menu');await menu.waitFor();
  const m=await menu.evaluate(el=>{const r=el.getBoundingClientRect();const items=[...el.querySelectorAll('[role=menuitem]')].map(i=>{const q=i.getBoundingClientRect();return i.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2));});return {r:[r.left,r.top,r.right,r.bottom,innerWidth,innerHeight],inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,items};});
  assert.ok(m.inside&&m.items.every(Boolean),`${tag}: row menu fully visible ${JSON.stringify(m)}`);
  const trig=await opts.boundingBox(),mb=await menu.boundingBox();assert.ok(Math.abs(mb.y-(trig.y+trig.height))<=trig.height+mb.height,`${tag}: menu sits by its row`);
  assert.equal(await page.locator('.sidebar').evaluate(el=>el.scrollTop),before,`${tag}: opening a menu keeps the drawer scroll`);
  await page.screenshot({path:`${out}/phone-review-${tag}-menu.png`});
  await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Diary',exact:true}).click();await drawer.waitFor({state:'hidden'});
  await open();await drawer.waitFor();await check('from Diary');await page.screenshot({path:`${out}/phone-review-${tag}-diary-drawer.png`});
  await page.close();
 }

 // Settings on a phone: stacked rows share one left edge; theme previews show their own
 // theme; the selected-theme ring follows the chosen accent.
 for(const [w,theme,accent] of [[500,'light','cool'],[500,'dark','warm'],[390,'dark','sage']]){
  const page=await browser.newPage({viewport:{width:w,height:761},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(([t,a])=>{localStorage.setItem('cowork-theme',t);localStorage.setItem('cowork-palette',a);localStorage.setItem('cowork-palette-'+t,a);},[theme,accent]);
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Profile',exact:true}).first().click();await page.locator('.settings-detail .set-row-label').first().waitFor();
  const lefts=await page.evaluate(()=>[...document.querySelectorAll('.settings-detail .set-row-label')].map(e=>Math.round(e.getBoundingClientRect().left)));
  assert.equal(new Set(lefts).size,1,`${w} ${theme}: Profile labels share one edge ${lefts}`);
  await page.getByRole('button',{name:'All settings',exact:true}).click();await page.getByRole('button',{name:'Appearance',exact:true}).first().click();await page.locator('.theme-swatch').first().waitFor();
  const lum=c=>{const [r,g,b]=c.match(/\d+/g).map(Number);return (r+g+b)/3;};
  const [light,dark]=await page.evaluate(()=>[...document.querySelectorAll('.theme-swatch:not(.is-system)')].map(e=>getComputedStyle(e).backgroundColor));
  assert.ok(lum(light)>180&&lum(dark)<80,`${w} ${theme}: previews show their own theme ${light} ${dark}`);
  const [ring,primary]=await page.evaluate(()=>[getComputedStyle(document.querySelector('.theme-choice button.is-active .theme-swatch')).outlineColor,getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim()]);
  const hex=primary.replace('#','');assert.equal(ring,`rgb(${parseInt(hex.slice(0,2),16)}, ${parseInt(hex.slice(2,4),16)}, ${parseInt(hex.slice(4,6),16)})`,`${w} ${theme} ${accent}: ring follows accent`);
  await page.close();
 }

 // Before the first stats reading the strip is neutral, not a red "Inference offline".
 {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/stats',()=>{});
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  const label=await page.locator('.stats-label').first().innerText();
  assert.notEqual(label,'Inference offline','no reading yet is not an outage');
  assert.ok(await page.locator('.stats-live-dot.unknown').count()>0,'neutral dot while unknown');
  await page.close();
 }

 // Desktop: each list keeps its heading in view while it scrolls.
 for(const theme of ['light','dark'])for(const material of ['liquid','soft']){
  const page=await browser.newPage({viewport:{width:1360,height:729},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(([t,m])=>{localStorage.setItem('cowork-theme',t);localStorage.setItem('noevia:material',m);},[theme,material]);
  const chat=(id,pinned=false)=>({id,title:`Synthetic ${id}`,updatedAt:1000,pinned,messages:[]});
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:Array.from({length:6},(_,i)=>({id:`p${i}`,name:`Synthetic project ${i}`,updatedAt:1000,files:[],chats:[]})),freeChats:[chat('pinned',true),chat('pinned2',true),chat('pinned3',true),...Array.from({length:14},(_,i)=>chat(`recent${i}`))]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  const res=await page.evaluate(()=>[...document.querySelectorAll('.sidebar .side-scroll')].map(el=>{el.scrollTop=el.scrollHeight;const head=el.querySelector(':scope > .sidebar-section-head, :scope > .section-label');const a=head.getBoundingClientRect(),b=el.getBoundingClientRect();const hit=document.elementFromPoint(a.x+20,a.y+a.height/2);return {list:el.className.split(' ').pop(),scrolled:el.scrollTop>0,headVisible:Math.abs(a.top-b.top)<=1&&head.contains(hit)};}));
  for(const r of res)if(r.scrolled)assert.ok(r.headVisible,`${theme} ${material}: ${r.list} heading stays in view ${JSON.stringify(r)}`);
  assert.ok(res.some(r=>r.scrolled),'at least one list scrolls at this height');
  await page.screenshot({path:`${out}/desktop-sticky-heads-${theme}-${material}.png`});await page.close();
 }

 // Touch: every Settings field is 16px (iOS zooms below that); Material's four options stay
 // on screen at 320px; Projects counts only active projects and its filter spans the row.
 for(const [w,h] of [[320,568],[390,844]]){
  const page=await browser.newPage({viewport:{width:w,height:h},hasTouch:true,isMobile:true,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  const proj=(i,archived=false)=>({id:`q${i}`,name:`Synthetic project ${i}`,archived,updatedAt:1000,files:[],chats:[{id:`qc${i}`,title:'c',updatedAt:1,messages:[]}]});
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[proj(0),proj(1),proj(2,true),proj(3,true)],freeChats:[]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('dialog',{name:'Navigation'}).getByRole('button',{name:'Projects',exact:true}).first().click();
  await page.getByRole('heading',{name:'Projects',level:1}).waitFor();
  assert.match(await page.locator('.projects-hero-sub').innerText(),/^2 projects · 2 chats$/,`${w}: headline counts active projects`);
  const fr=await page.evaluate(()=>{const f=document.querySelector('.projects-search').getBoundingClientRect(),c=document.querySelector('.project-card').getBoundingClientRect();return Math.abs(f.right-c.right);});
  assert.ok(fr<=1,`${w}: filter spans the row like the cards (${fr}px short)`);
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();
  for(const name of ['Security','Data','Appearance','Diary & storage']){
   await page.locator('.settings-navigation nav button').filter({hasText:name}).first().click();await page.locator('.settings-detail').waitFor();
   const small=await page.evaluate(()=>[...document.querySelectorAll('.settings-detail :is(input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select)')].filter(e=>e.offsetParent&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>(e.getAttribute('aria-label')||e.tagName)+' '+getComputedStyle(e).fontSize));
   assert.deepEqual(small,[],`${w} ${name}: fields under 16px on touch`);
   if(name==='Appearance'){const seg=page.getByRole('radiogroup',{name:'Material'});await seg.getByRole('radio',{name:'Material 3'}).click();await page.waitForTimeout(300);
    const g=await seg.evaluate(t=>{const q=t.getBoundingClientRect(),on=t.querySelector('[aria-checked="true"]').getBoundingClientRect(),th=t.querySelector('.glass-thumb').getBoundingClientRect();return {inScreen:q.left>=0&&q.right<=innerWidth,onVisible:on.left>=q.left-1&&on.right<=q.right+1,thumb:Math.abs(th.left-on.left)<=1};});
    assert.ok(g.inScreen&&g.onVisible&&g.thumb,`${w}: Material track fits, shows the choice, thumb on it ${JSON.stringify(g)}`);
    await seg.getByRole('radio',{name:'Soft'}).click();}
   await page.getByRole('button',{name:'All settings',exact:true}).click();
  }
  await page.close();
 }

 // Material 3: sticky pieces match the drawer (no bands), New chat is an extended FAB in
 // primary-container, the active destination is a pill, the composer a 28px container.
 for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1360,height:729},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>{localStorage.setItem('cowork-theme',t);localStorage.setItem('noevia:material','material');},theme);
  const chat=(id,pinned=false)=>({id,title:`Synthetic ${id}`,updatedAt:1000,pinned,messages:[]});
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{id:'p0',name:'Synthetic project 0',updatedAt:1000,files:[],chats:[]}],freeChats:[chat('pinned',true),...Array.from({length:14},(_,i)=>chat(`recent${i}`))]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  await page.getByRole('button',{name:'Projects',exact:true}).first().click();
  const m=await page.evaluate(()=>{const cs=e=>getComputedStyle(e),q=s=>document.querySelector(s),side=q('.sidebar');const root=cs(document.documentElement);
   const heads=[...side.querySelectorAll('.side-scroll > :is(.sidebar-section-head, .section-label):first-child, .side-permanent, .side-footer')].map(e=>cs(e).backgroundColor);
   return {side:cs(side).backgroundColor,heads,fab:cs(q('.new-chat-btn')).backgroundColor,fabRadius:cs(q('.new-chat-btn')).borderTopLeftRadius,
    primaryContainer:root.getPropertyValue('--md-primary-container').trim(),active:cs(q('.side-nav .nav-item[aria-current=page]')).borderTopLeftRadius,
    composerRadius:cs(q('.composer-inner')).borderTopLeftRadius,font:cs(document.body).fontFamily};});
  for(const h of m.heads)assert.equal(h,m.side,`${theme} M3: sticky sidebar pieces share the drawer colour ${JSON.stringify(m)}`);
  const hex=m.primaryContainer.replace('#','');assert.equal(m.fab,`rgb(${parseInt(hex.slice(0,2),16)}, ${parseInt(hex.slice(2,4),16)}, ${parseInt(hex.slice(4,6),16)})`,`${theme} M3: New chat is primary-container`);
  assert.equal(m.fabRadius,'16px');assert.ok(parseFloat(m.active)>=20,`${theme} M3: active destination is a pill`);assert.equal(m.composerRadius,'28px');assert.match(m.font,/^Roboto/);
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS phone drawer: full drawer from Diary, measured sticky footer, no rows under it, Plugins reachable, row menus unclipped beside their row without resetting scroll (four viewports, both themes); Settings rows share one edge, theme previews show their own theme, the selected ring follows the accent; the inference strip is neutral before its first reading; desktop list headings stay in view while their list scrolls; Settings fields are 16px on touch, the Material track fits at 320px, Projects counts active projects and its filter spans the row; Material 3 has no sticky bands, an extended FAB, pill destinations, a 28px composer and Roboto.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
