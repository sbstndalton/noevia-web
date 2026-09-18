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
 assert.deepEqual(errors,[]);
 console.log('PASS phone drawer: full drawer from Diary, measured sticky footer, no rows under it, Plugins reachable, row menus unclipped beside their row without resetting scroll (four viewports, both themes); Settings rows share one edge, theme previews show their own theme, the selected ring follows the accent.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
