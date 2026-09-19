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
  const layout=()=>page.evaluate(()=>{const s=document.querySelector('.sidebar'),p=s.querySelector('.side-nav').getBoundingClientRect(),f=s.querySelector('.side-footer').getBoundingClientRect(),b=s.getBoundingClientRect();
    const sticky=getComputedStyle(s.querySelector('.side-footer')).position==='sticky';
    return {sticky,overlap:Math.min(0,p.bottom-f.top),diaryInNav:!!s.querySelector('.side-footer-row [aria-label=Diary]'),gapBelowFooter:b.bottom-f.bottom,labels:[...s.querySelectorAll('.nav-name')].filter(n=>n.getBoundingClientRect().width>2).length,lists:s.querySelectorAll('.side-scroll').length&&getComputedStyle(s.querySelector('.side-scroll')).display!=='none'};});
  const check=async(label)=>{const l=await layout();
   assert.ok(l.labels>=2&&l.lists&&l.diaryInNav,`${tag} ${label}: drawer shows labels and lists ${JSON.stringify(l)}`);
   if(l.sticky){assert.ok(l.overlap<=1,`${tag} ${label}: top destinations under the footer ${JSON.stringify(l)}`);assert.ok(l.gapBelowFooter<=1,`${tag} ${label}: rows show below the footer ${JSON.stringify(l)}`);}
   const plugins=page.getByRole('button',{name:'Plugins',exact:true});await plugins.scrollIntoViewIfNeeded();
   await plugins.evaluate((el,t)=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!el.contains(hit))throw Error(t+': Plugins covered by '+(hit?.className||hit?.tagName));},`${tag} ${label}`);};
  await open();await drawer.waitFor();await check('from chat');
  const orow=page.locator('.chat-row').filter({hasText:'Synthetic recent7'});await orow.scrollIntoViewIfNeeded();if(!touch)await orow.hover();const opts=page.getByRole('button',{name:'Options for Synthetic recent7',exact:true});
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
  await page.getByRole('button',{name:'Account',exact:true}).first().click();await page.locator('.settings-detail .set-row-label').first().waitFor();
  const lefts=await page.evaluate(()=>[...document.querySelectorAll('.settings-detail .set-row-label')].map(e=>Math.round(e.getBoundingClientRect().left)));
  assert.equal(new Set(lefts).size,1,`${w} ${theme}: Profile labels share one edge ${lefts}`);
  await page.getByRole('button',{name:'All settings',exact:true}).click();await page.getByRole('button',{name:'General',exact:true}).first().click();await page.locator('.theme-swatch').first().waitFor();
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
  for(const name of ['Security and login','Data controls','General','Diary & storage']){
   await page.locator('.settings-navigation nav button').filter({hasText:name}).first().click();await page.locator('.settings-detail').waitFor();
   const small=await page.evaluate(()=>[...document.querySelectorAll('.settings-detail :is(input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select)')].filter(e=>e.offsetParent&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>(e.getAttribute('aria-label')||e.tagName)+' '+getComputedStyle(e).fontSize));
   assert.deepEqual(small,[],`${w} ${name}: fields under 16px on touch`);
   if(name==='General'){const seg=page.getByRole('radiogroup',{name:'Material'});await seg.getByRole('radio',{name:'Material 3'}).click();await page.waitForTimeout(300);
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

 // Desktop, short window: the sidebar is one scrolling plane — no nested scrollers, every
 // chat rendered, the last one reachable by scrolling the sidebar itself, Diary pinned.
 for(const material of ['liquid','material','soft']){
  const page=await browser.newPage({viewport:{width:1400,height:729},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(m=>{localStorage.setItem('noevia:material',m);localStorage.setItem('cowork-theme','dark');},material);
  const chat=(id,pinned=false)=>({id,title:`Synthetic ${id}`,updatedAt:1000,pinned,messages:[]});
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  await page.route('**/api/toolboxes',r=>r.fulfill({json:{toolboxes:[],mcp:{configured:true,discovered:176,servers:[{id:'a'},{id:'b'},{id:'c'}]}}}));
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[0,1,2].map(i=>({id:`p${i}`,name:`Synthetic project ${i}`,updatedAt:1000,files:[],chats:[]})),freeChats:[chat('pinned',true),chat('pinned2',true),...Array.from({length:16},(_,i)=>chat(`recent${i}`))]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  const r=await page.evaluate(async()=>{const side=document.querySelector('.sidebar');
   const nested=[...side.querySelectorAll('*')].filter(e=>/(auto|scroll)/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1).map(e=>e.className.toString());
   const rows=side.querySelectorAll('.recent-children .chat-row').length;
   side.scrollTop=side.scrollHeight;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const last=[...side.querySelectorAll('.recent-children .chat-row')].at(-1).getBoundingClientRect(),foot=side.querySelector('.side-footer').getBoundingClientRect(),sb=side.getBoundingClientRect();
   return {sideScrolls:getComputedStyle(side).overflowY==='auto'&&side.scrollHeight>side.clientHeight,nested,rows,lastAboveFooter:last.bottom<=foot.top+1,footerAtBottom:sb.bottom-foot.bottom<=1,diaryInNav:!!side.querySelector('.side-footer-row [aria-label=Diary]')};});
  assert.ok(r.sideScrolls,`${material}: the sidebar itself scrolls ${JSON.stringify(r)}`);
  assert.deepEqual(r.nested,[],`${material}: no nested scrollers`);
  assert.equal(r.rows,16,`${material}: every recent chat is in the sidebar`);
  assert.ok(r.lastAboveFooter&&r.footerAtBottom&&r.diaryInNav,`${material}: last chat reachable above the pinned account row; Diary in the bottom bar ${JSON.stringify(r)}`);
  await page.close();
 }

 // Collapsed desktop rail, like ChatGPT's: icons only, equal 40px (M3: its rail), no lists,
 // headings or status text, the avatar at the bottom edge.
 for(const material of ['liquid','material','soft']){
  const page=await browser.newPage({viewport:{width:1400,height:800},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(m=>localStorage.setItem('noevia:material',m),material);
  await page.route('**/api/toolboxes',r=>r.fulfill({json:{toolboxes:[],mcp:{configured:true,discovered:176,servers:[{id:'a'}]}}}));
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{id:'p0',name:'Synthetic project 0',updatedAt:1000,files:[],chats:[]}],freeChats:[{id:'c0',title:'Synthetic c0',updatedAt:1,pinned:true,messages:[]},{id:'c1',title:'Synthetic c1',updatedAt:1,messages:[]}]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();await page.waitForTimeout(300);
  const r=await page.evaluate(()=>{const s=document.querySelector('.sidebar'),sb=s.getBoundingClientRect(),vis=e=>{const q=e.getBoundingClientRect();return q.width>0&&q.height>0&&q.left<sb.right&&q.right>sb.left;};
   const leaks=[...s.querySelectorAll('.sidebar-history, .section-label, .mcp-row, .nav-name, .side-logo span')].filter(vis).map(e=>e.className);
   const icons=[...s.querySelectorAll('.side-nav .nav-item, .rail-tools .shell-icon-button, .side-expand, .side-footer-diary')].filter(vis).map(e=>{const q=e.getBoundingClientRect();return [Math.round(q.width),Math.round(q.height)];});
   const acct=s.querySelector('.account-trigger').getBoundingClientRect();return {w:Math.round(sb.width),leaks,icons,acctAtBottom:sb.bottom-acct.bottom<40,noOverflow:s.scrollWidth<=s.clientWidth+1};});
  assert.deepEqual(r.leaks,[],`${material}: collapsed rail shows no lists or text ${JSON.stringify(r)}`);
  assert.ok(r.icons.length>=5&&r.icons.every(([w,h])=>(material==="material"||w===h)&&h>=32)&&r.acctAtBottom&&r.noOverflow,`${material}: icon rail with the avatar at the bottom ${JSON.stringify(r)}`);
  await page.reload();await page.getByPlaceholder('Message noevia…').waitFor();
  assert.ok(await page.locator('.sidebar').evaluate(s=>s.classList.contains('is-collapsed')),`${material}: collapsed survives a reload`);
  const sb=await page.locator('.sidebar').boundingBox();await page.mouse.click(sb.x+sb.width/2,sb.y+sb.height*0.7);
  assert.ok(await page.locator('.sidebar').evaluate(s=>!s.classList.contains('is-collapsed')),`${material}: clicking the empty rail expands it`);
  await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();
  await page.getByRole('button',{name:'Search projects and chats'}).last().click();
  assert.ok(await page.locator('.sidebar').evaluate(s=>!s.classList.contains('is-collapsed')),`${material}: rail Search opens the sidebar`);
  await page.close();
 }

 // Like Claude: the light/dark switch is in the account menu and Search sits beside the
 // account; the menu opens in full from the collapsed rail; Code never blanks while loading.
 for(const collapsedRail of [false,true]){
  const page=await browser.newPage({viewport:{width:1400,height:800},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(c=>{localStorage.setItem('cowork-theme','light');localStorage.setItem('noevia:sidebar-collapsed',c?'1':'0');},collapsedRail);
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  assert.equal(await page.locator('.shell-sidebar-head button[aria-label*="mode"]').count(),0,'no theme button in the sidebar head');
  if(!collapsedRail){const g=await page.evaluate(()=>{const a=document.querySelector('.side-footer-row .account-trigger').getBoundingClientRect(),q=document.querySelector('.side-footer-row .side-footer-search').getBoundingClientRect();return {sameRow:Math.abs((a.top+a.height/2)-(q.top+q.height/2))<4,right:q.left>=a.right-1};});assert.ok(g.sameRow&&g.right,`Search beside the account ${JSON.stringify(g)}`);}
  await page.getByRole('button',{name:/Account menu for/}).click();
  const menu=page.locator('.account-popover');await menu.waitFor();
  const inView=await menu.evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('button')].every(b=>{const q=b.getBoundingClientRect();return b.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2));})&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
  assert.ok(inView,`${collapsedRail?'collapsed':'expanded'}: account menu fully visible and clickable`);
  await menu.getByRole('button',{name:'Dark mode',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark','the account menu switches the theme');
  await menu.getByRole('button',{name:'Light mode',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  if(!collapsedRail){
   await page.addInitScript(()=>{window.requestIdleCallback=()=>0;});
   await page.route('**/assets/CodingWorkspace-*.js',async r=>{await new Promise(x=>setTimeout(x,600));await r.continue();});
   await page.reload();await page.getByPlaceholder('Message noevia…').waitFor();
   await page.evaluate(()=>{window.__frames=[];const probe=()=>{window.__frames.push(document.body.innerText.trim().length>20&&!!document.querySelector('.regular-workspace:not([style*="none"]) *, .code-mount:not([style*="none"]) *')?1:0);if(window.__frames.length<120)requestAnimationFrame(probe);};requestAnimationFrame(probe);});
   await page.getByRole('button',{name:'Code',exact:true}).first().click();
   await page.getByPlaceholder(/Describe a task/).waitFor();
   const blank=await page.evaluate(()=>window.__frames.filter(x=>!x).length);assert.equal(blank,0,'entering Code never shows a blank frame');
  }
  await page.close();
 }

 // Composer like Claude's: the + is a centred SVG and its menu no longer repeats the model;
 // Thinking is a menu of levels. A closed sidebar stays closed across Chat ⇄ Code. No
 // control uses a text glyph as its icon, and icon-only buttons are centred.
 {
  const page=await browser.newPage({viewport:{width:1360,height:820},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  await page.route('**/api/reasoning-settings*',r=>r.fulfill({json:{default:'default',effort:'default',mode:'hint',admin:true}}));
  const saved=[];await page.route('**/api/projects/q0/config',r=>{saved.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{id:'q0',name:'Synthetic project q0',updatedAt:1000,files:[],assets:[],memories:[],instructions:'',goal:'',sourceFolders:[],chats:[],toolboxes:['core'],createdAt:1}],freeChats:[]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  const centred=()=>page.evaluate(()=>[...document.querySelectorAll('button:not(.project-expand)')].filter(b=>b.getBoundingClientRect().width>4&&!b.innerText.trim()&&b.querySelectorAll('svg').length===1).map(b=>{const r=b.getBoundingClientRect(),q=b.querySelector('svg').getBoundingClientRect();return {l:b.getAttribute('aria-label'),dx:Math.abs((q.left+q.width/2)-(r.left+r.width/2)),dy:Math.abs((q.top+q.height/2)-(r.top+r.height/2))};}).filter(x=>x.dx>1||x.dy>1));
  const glyphs=()=>page.evaluate(()=>[...document.querySelectorAll('button, summary')].map(b=>b.innerText.trim()).filter(t=>/^[+＋✕×›‹→←↑↓◇▾]/.test(t)||/[✕×›◇▾]$/.test(t)));
  await page.getByRole('button',{name:'Projects',exact:true}).first().click();await page.locator('.project-card').first().click();
  const plus=page.getByRole('button',{name:'Add files and tools'});await plus.waitFor();
  assert.equal(await plus.locator('svg').count(),1,'the + is an SVG');assert.equal((await plus.innerText()).trim(),'');
  await plus.click();const panel=page.getByRole('region',{name:'Files and tools'});await panel.waitFor();
  assert.equal(await panel.getByText(/model and routing/i).count(),0,'the + menu does not repeat the model control');
  assert.ok(await panel.getByRole('button',{name:/Add files or photos/}).count(),'files first');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Thinking effort',exact:true}).click();
  const menu=page.getByRole('menu',{name:'Thinking effort'});await menu.waitFor();
  assert.deepEqual((await menu.getByRole('menuitemradio').allInnerTexts()).map(t=>t.split('\n')[0]),['Auto','Low','Standard','High']);
  await menu.getByRole('menuitemradio',{name:/^High/}).click();await menu.waitFor({state:'hidden'});
  await page.waitForFunction(()=>true);assert.deepEqual(saved.at(-1),{reasoningEffort:'high'},'choosing High saves it');
  assert.deepEqual(await centred(),[],'icon-only buttons are centred');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>{const s=b.querySelector(':scope > svg');return s&&b.innerText.trim()&&getComputedStyle(s).display==='block'&&getComputedStyle(s).marginLeft!=='0px';}).map(b=>b.innerText.trim())),[],'icon + text buttons keep the icon at the start');assert.deepEqual(await glyphs(),[],'no text-glyph icons');
  // Hover options sit beside the title, like ChatGPT's, never over it.
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[],freeChats:[{id:'h0',title:'Synthetic chat with a deliberately long title that must fade',updatedAt:2,messages:[]}]}}));
  await page.reload();await page.getByPlaceholder('Message noevia…').waitFor();
  const hrow=page.locator('.chat-row').first();await hrow.hover();
  const ov=await hrow.evaluate(el=>{const l=el.querySelector('.sidebar-label').getBoundingClientRect(),a=el.querySelector('.row-actions').getBoundingClientRect();return {shown:a.width>0,overlap:l.right-a.left};});
  assert.ok(ov.shown&&ov.overlap<=0.5,`hover options never cover the title ${JSON.stringify(ov)}`);
  await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();
  await page.getByRole('button',{name:'Code',exact:true}).first().click();await page.getByPlaceholder(/Describe a task/).waitFor();
  assert.ok(await page.locator('.sidebar.pane[data-mode=code]').evaluate(e=>e.classList.contains('is-collapsed')),'Code keeps a closed sidebar closed');
  assert.deepEqual(await glyphs(),[],'no text-glyph icons in Code');
  await page.getByRole('button',{name:'Chat',exact:true}).first().click();await page.getByPlaceholder(/Message/).first().waitFor();
  assert.ok(await page.locator('.sidebar.pane[data-mode=chat]').evaluate(e=>e.classList.contains('is-collapsed')),'and Chat again');
  await page.close();
 }

 // Diary in the bottom bar; the Chat/Code thumb slides both ways; project colours everywhere
 // with the icon beside its name; the phone Code drawer opens and closes from its toggle.
 {
  const page=await browser.newPage({viewport:{width:1300,height:760}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  const proj={id:'k0',name:'Coloured',icon:'chart',color:'#64b888',updatedAt:1000,files:[],assets:[],memories:[],instructions:'',goal:'',sourceFolders:[],chats:[],toolboxes:['core'],createdAt:1};
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[proj],freeChats:[]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  assert.equal(await page.locator('.side-footer-row [aria-label="Diary"]').count(),1,'Diary sits in the bottom bar');
  assert.equal(await page.locator('.side-nav [aria-label="Diary"]').count(),0,'and not in the top destinations');
  const green='rgb(100, 184, 136)';
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.sidebar .project-icon')].map(e=>getComputedStyle(e).color)),[green],'sidebar icon uses the project colour');
  const lay=await page.locator('.proj-row').first().evaluate(r=>{const i=r.querySelector('.project-expand').getBoundingClientRect(),l=r.querySelector('.sidebar-label').getBoundingClientRect(),q=r.getBoundingClientRect();return {iconAtStart:i.left-q.left<24,nameNextToIcon:l.left-i.right<16};});
  assert.ok(lay.iconAtStart&&lay.nameNextToIcon,`project row keeps icon and name together at the start ${JSON.stringify(lay)}`);
  await page.getByRole('button',{name:'Projects',exact:true}).first().click();await page.locator('.project-card .project-icon').first().waitFor();
  const cards=await page.evaluate(()=>[...document.querySelectorAll('.project-card .project-icon')].map(e=>getComputedStyle(e).color));
  assert.deepEqual(cards,[green],`card icon uses the project colour ${JSON.stringify(cards)}`);
  const track=async sel=>{const xs=[];for(let i=0;i<14;i++){xs.push(await page.evaluate(q=>{const t=document.querySelector(q);return t&&t.getBoundingClientRect().width?Math.round(t.getBoundingClientRect().left):null;},sel));await page.waitForTimeout(35);}return xs.filter(x=>x!==null);};
  await page.getByRole('button',{name:'Code',exact:true}).first().click();
  const toCode=await track('.sidebar.pane .app-mode-switch > .glass-thumb');
  assert.ok(new Set(toCode).size>=3,`the thumb slides to Code ${toCode}`);
  await page.getByRole('button',{name:'Chat',exact:true}).first().click();
  const toChat=await track('.sidebar.pane .app-mode-switch > .glass-thumb');
  assert.ok(new Set(toChat).size>=3,`and back to Chat ${toChat}`);
  await page.close();
  const phone=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});phone.on('pageerror',e=>errors.push(e.message));
  await phone.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true}}}));
  await phone.goto('http://localhost:31377');await phone.getByPlaceholder('Message noevia…').waitFor();
  await phone.getByRole('button',{name:'Open navigation',exact:true}).tap();await phone.getByRole('button',{name:'Code',exact:true}).first().tap();await phone.getByPlaceholder(/Describe a task/).waitFor();
  // Code shares the chat drawer (user review, 2026-09-19): the same toggle opens it, with Code's destinations.
  await phone.getByRole('button',{name:'Open navigation',exact:true}).tap();
  const cd=phone.getByRole('dialog',{name:'Navigation'});await cd.getByRole('button',{name:'Pull requests'}).waitFor();
  assert.equal(await phone.locator('.coding-sidebar').count(),0,'no separate Code sidebar');
  await phone.getByRole('button',{name:'Chat',exact:true}).tap();await phone.getByPlaceholder('Message noevia…').waitFor();
  assert.equal(await phone.locator('.sidebar.pane').evaluate(e=>e.classList.contains('is-expanded')),false,'switching to Chat leaves the drawer closed');
  await phone.getByRole('button',{name:'Open navigation',exact:true}).tap();
  const d=await phone.evaluate(()=>{const s=document.querySelector('.sidebar.is-expanded'),h=s.querySelector('.shell-sidebar-head'),sw=h.querySelector('.app-mode-switch.is-compact'),logo=h.querySelector('.side-logo');const r=s.getBoundingClientRect(),q=sw.getBoundingClientRect(),l=logo.getBoundingClientRect();return {fullWidth:Math.round(r.width)>=innerWidth-1,switchAfterLogo:q.left>l.right,switchH:Math.round(q.height),search:!!s.querySelector('.shell-search')};});
  assert.ok(d.fullWidth&&d.switchAfterLogo&&d.search&&d.switchH<=40,`phone drawer like Claude's ${JSON.stringify(d)}`);
  await phone.getByRole('button',{name:'Code',exact:true}).tap();await phone.getByPlaceholder(/Describe a task/).waitFor();
  assert.equal(await phone.locator('.sidebar.pane').evaluate(e=>e.classList.contains('is-expanded')),false,'switching to Code closes the drawer');
  await phone.close();
 }

 // Visual pass on real device layouts (iPhone user agent → data-layout="mobile"): the Settings
 // list is full width with readable labels; the composer row fits at 375px; project and chat
 // rows start their icons and titles on one line in every material.
 {
  const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const page=await browser.newPage({viewport:{width:375,height:812},hasTouch:true,isMobile:true,userAgent:iphone});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/reasoning-settings*',r=>r.fulfill({json:{default:'default',effort:'default',mode:'hint',admin:true}}));
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{id:'v0',name:'Finances',updatedAt:1000,files:[],assets:[],memories:[],instructions:'',goal:'',sourceFolders:[],chats:[],toolboxes:['core'],createdAt:1}],freeChats:[]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.layout),'mobile','iPhone gets the mobile layout');
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).first().click();await page.locator('.project-card').first().click();
  await page.locator('.composer-inner').first().waitFor();
  const spill=await page.evaluate(()=>{const c=document.querySelector('.composer-inner').getBoundingClientRect();return [...document.querySelectorAll('.composer-inner button')].filter(b=>{const q=b.getBoundingClientRect();return q.width&&(q.right>c.right-1||q.left<c.left+1);}).map(b=>b.getAttribute('aria-label'));});
  assert.deepEqual(spill,[],'composer controls stay inside the composer at 375px');
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();await page.locator('.settings-navigation nav button').first().waitFor();
  const list=await page.evaluate(()=>{const n=document.querySelector('.settings-navigation'),b=n.querySelector('nav button');return {w:Math.round(n.getBoundingClientRect().width),fs:parseFloat(getComputedStyle(b).fontSize)};});
  assert.ok(list.w>=370&&list.fs>=15,`Settings list is full width with readable labels on an iPhone ${JSON.stringify(list)}`);
  await page.close();
 }
 for(const material of ['liquid','material','soft','glass']){
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.addInitScript(m=>localStorage.setItem('noevia:material',m),material);
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{id:'r0',name:'Pinned project',pinned:true,updatedAt:1,files:[],chats:[],createdAt:1},{id:'r1',name:'Finances',updatedAt:1,files:[],chats:[],createdAt:1}],freeChats:[{id:'rc',title:'Testing',updatedAt:2,messages:[]}]}}));
  await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
  const edges=await page.evaluate(()=>{const S=document.querySelector('.sidebar').getBoundingClientRect().left;return [...document.querySelectorAll('.proj-row, .chat-row')].map(r=>[Math.round(r.querySelector('svg').getBoundingClientRect().left-S),Math.round(r.querySelector('.sidebar-label').getBoundingClientRect().left-S)]);});
  assert.equal(new Set(edges.map(e=>e.join())).size,1,`${material}: project and chat rows share one icon and title edge ${JSON.stringify(edges)}`);
  const head=await page.evaluate(()=>{const h=[...document.querySelectorAll('.sidebar-section-head')].find(x=>x.querySelector('.section-options'));const l=h.querySelector('.section-label').getBoundingClientRect(),o=h.querySelector('.section-options').getBoundingClientRect();return Math.abs((o.top+o.height/2)-(l.top+l.height/2));});
  assert.ok(head<=1,`${material}: a heading's options button lines up with its label (${head}px)`);
  await page.close();
 }

 // No square focus ring inside the rounded composer; with a software keyboard open (iOS shrinks
 // the visible viewport and scrolls the page by offsetTop) the app covers exactly what is visible.
 {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const v=new EventTarget();Object.assign(v,{height:844,width:390,scale:1,offsetTop:0,offsetLeft:0});Object.defineProperty(window,'visualViewport',{value:v});window.__kb=(h,top)=>{v.height=h;v.offsetTop=top;v.dispatchEvent(new Event('resize'));v.dispatchEvent(new Event('scroll'));};});
  await page.goto('http://localhost:31377');const ta=page.getByPlaceholder('Message noevia…');await ta.waitFor();await ta.focus();
  assert.equal(await ta.evaluate(e=>getComputedStyle(e).outlineStyle),'none','no square focus ring on the text area');
  await page.evaluate(()=>window.__kb(460,180));await page.waitForTimeout(150);
  const a=await page.evaluate(()=>{const r=document.querySelector('.app').getBoundingClientRect();return [Math.round(r.top),Math.round(r.height)];});
  assert.deepEqual(a,[180,460],'with the keyboard open the app covers exactly the visible area');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.app')).position),'fixed','on a phone the shell is fixed, so iOS has no document to push up');
  await page.evaluate(()=>{document.body.style.minHeight='2000px';window.scrollTo(0,300);});await ta.blur();await ta.focus();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.scrollY),0,'a document scroll from the keyboard is reset');
  await page.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS phone drawer: full drawer from Diary, Diary in the bottom bar, only the account row pinned, no rows under it, Plugins reachable, row menus unclipped beside their row without resetting scroll (four viewports, both themes); Settings rows share one edge, theme previews show their own theme, the selected ring follows the accent; the inference strip is neutral before its first reading; Settings fields are 16px on touch, the Material track fits at 320px, Projects counts active projects and its filter spans the row; Material 3 has no sticky bands, an extended FAB, pill destinations, a 28px composer and Roboto; on a short desktop the sidebar is one scrolling plane with every chat, in each material; collapsed, it is an icon-only rail with the avatar at the bottom that survives a reload and expands from its empty space; light/dark is in the account menu with Search beside the account, the menu opens in full from the rail, and Code never blanks while loading; the composer + is a centred SVG without a duplicate model entry, Thinking is a menu of levels, a closed sidebar stays closed across Chat and Code, and no icon is a text glyph; icon + text buttons keep their icon at the start and hover options never cover a title; Diary is in the bottom bar, the Chat/Code thumb slides both ways, project colours show in the sidebar and on cards, and the phone Code drawer opens and closes; the mode switch is a small track in the header row, the phone drawer is full width with search on top, and switching mode closes it; on an iPhone Settings is a full-width list, the composer fits at 375px, and rows and headings line up in every material; no square focus ring inside the composer, and the app follows an open keyboard.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
