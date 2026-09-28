// #502: populated navigation on real built app; all API data stays synthetic.
// QA_DIST=/tmp/build QA_SCREENSHOTS=/tmp/shots node qa/sidebar-surfaces-502.cjs
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||`${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-sidebar-502';
const failures=[],errors=[];let checks=0;
const check=(ok,label,detail)=>{checks++;if(!ok)failures.push({label,detail});};
(async()=>{
 fs.mkdirSync(out,{recursive:true});const fixture=createFixture(Number(process.env.QA_PORT||31502));await fixture.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 for(const [width,height] of [[1440,900],[768,900],[390,650],[320,360],[667,375]])for(const theme of ['light','dark'])for(const family of ['editorial','contemporary','glass']){
  const name=`${family}-${theme}-${width}x${height}`;
  const page=await browser.newPage({viewport:{width,height},isMobile:width<520,hasTouch:true,reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push({name,error:e.message}));
  await page.route('https://**/*',r=>r.abort());
  await page.addInitScript(({theme,family})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:theme-family',family);},{theme,family});
  await page.route('**/api/profile/appearance',r=>r.fulfill({json:{theme,light:'sage',dark:'sage'}}));
  await page.route('**/api/toolboxes',r=>r.fulfill({json:{toolboxes:[],mcp:{configured:true,discovered:175,servers:[{id:'synthetic-a',auth:'internal',error:null,discovered:100},{id:'synthetic-b',auth:'internal',error:null,discovered:50},{id:'synthetic-c',auth:'internal',error:null,discovered:25}]}}}));
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:Array.from({length:8},(_,i)=>({id:`p${i}`,name:`Synthetic project ${i}`,updatedAt:1000-i,files:[],chats:[]})),freeChats:[{id:'pin',title:'Synthetic pinned chat',pinned:true,updatedAt:1000},...Array.from({length:10},(_,i)=>({id:`chat${i}`,title:`Synthetic chat ${i}`,updatedAt:900-i}))]}}));
  await page.goto(`http://localhost:${process.env.QA_PORT||31502}`);await page.getByPlaceholder('Message noevia…').waitFor();
  if(width<520)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  else {const expand=page.getByRole('button',{name:'Expand navigation',exact:true});if(await expand.isVisible())await expand.click();}
  await page.locator('.sidebar').waitFor({state:'visible'});
  // Wait for the reduced-motion enter animation to paint before collecting visual evidence.
  await page.waitForTimeout(100);
  await page.screenshot({path:path.join(out,`${name}-top.png`)});
  const surfaces=await page.locator('.sidebar').evaluate(side=>{
   const footer=side.querySelector('.side-footer'),scroll=side.querySelector('.sidebar-scroll');
   return {strips:[...side.querySelectorAll('.sidebar-section-head,.side-new,.side-footer')].map(e=>({class:e.className,fill:getComputedStyle(e).backgroundColor,image:getComputedStyle(e).backgroundImage})),scroll:scroll?.getBoundingClientRect().toJSON(),footer:footer.getBoundingClientRect().toJSON()};
  });
  check(surfaces.strips.every(s=>s.fill==='rgba(0, 0, 0, 0)'&&s.image==='none'),`${name}: no redundant rectangular surface`,surfaces.strips);
  if(height>600)check(surfaces.scroll&&surfaces.scroll.bottom<=surfaces.footer.top+1,`${name}: scroller ends above account area`,surfaces);
  // Reach the last project and last chat without the footer intercepting their hit targets.
  for(const label of ['Options for Synthetic project 7','Options for Synthetic chat 9']){
   const target=page.getByRole('button',{name:label,exact:true});await target.scrollIntoViewIfNeeded();
   check(await target.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight+1&&e.contains(hit);}),`${name}: ${label} remains reachable`);
   await target.click();await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');
  }
  if(height>600){
   check(await page.locator('.new-chat-btn').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`${name}: sticky New chat remains available`);
  }
  await page.screenshot({path:path.join(out,`${name}-scrolled.png`)});
  const account=page.getByRole('button',{name:/Account menu for/});await account.scrollIntoViewIfNeeded();await account.click();
  await page.locator('.account-popover').waitFor();await page.waitForTimeout(100);
  check(await page.locator('.account-popover').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1;}),`${name}: account menu fits viewport`);
  await page.screenshot({path:path.join(out,`${name}-account.png`)});await page.keyboard.press('Escape');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: no horizontal overflow`);
  if(width>=520){
   await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();
   check(await page.locator('.sidebar').evaluate(e=>e.getBoundingClientRect().width<=64),`${name}: collapsed rail retains geometry`);
  }
  await page.close();
 }
 check(errors.length===0,'no browser errors',errors);check(fixture.requests.length===0,'no inference requests',fixture.requests);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,failures,errors},null,2));
 console.log(JSON.stringify({checks,failures},null,2));if(failures.length)process.exitCode=1;
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
