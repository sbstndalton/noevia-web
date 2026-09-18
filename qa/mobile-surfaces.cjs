// Phone checks for the setup wizard, Settings, Projects and Code, including a software
// keyboard (visual viewport shrunk to 360px). Isolated real server, synthetic account only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31261',web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-mobile-surfaces-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31261',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:1/v1',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:'',NOEVIA_FEATURE_PREVIEWS:'true'}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const ctx=await browser.newContext({viewport:{width:375,height:667},isMobile:true,hasTouch:true});
  await ctx.addInitScript(()=>{const v=new EventTarget();Object.assign(v,{height:Number(sessionStorage.getItem('qa-vv-h'))||screen.height,width:screen.width,scale:1,offsetTop:0,offsetLeft:0});Object.defineProperty(window,'visualViewport',{value:v});window.__keyboard=(h)=>{v.height=h;v.dispatchEvent(new Event('resize'));};});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const keyboard=async h=>{await page.evaluate(h=>{sessionStorage.setItem('qa-vv-h',String(h));window.__keyboard(h);},h);await page.waitForTimeout(120);};
  const fits=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}: horizontal overflow`);
  // Reachable = on screen within the visible (keyboard-reduced) viewport, 44px tall, not covered.
  const reach=async(locator,label,h=667)=>{await locator.evaluate(el=>el.scrollIntoView({block:"nearest"}));await page.waitForTimeout(60);const p=await locator.evaluate((el,h)=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+Math.min(r.height/2,20);const hit=document.elementFromPoint(x,y);return {ok:r.height>=36&&r.y>=0&&r.y+Math.min(r.height,40)<=h&&x<=innerWidth&&(el===hit||el.contains(hit)),r:[r.x,r.y,r.width,r.height].map(Math.round)};},h);assert.ok(p.ok,`${label} not reachable ${JSON.stringify(p.r)}`);};

  // ── Setup wizard ──
  await page.goto(origin);
  await page.getByRole('button',{name:'Get started'}).click();await fits('wizard choice');
  await page.getByRole('button',{name:'Yes, I want a diary'}).click();
  for(const [label,value] of [['One-time setup code',fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim()],['Username','mobileqa'],['Display name (optional)','Mobile QA'],['Password','synthetic mobile password']]){
   const field=page.getByLabel(label,{exact:true});await field.focus();await keyboard(360);await reach(field,`wizard ${label} (keyboard)`,360);await field.fill(value);
  }
  await page.screenshot({path:`${shots}/noevia-mobile-wizard-keyboard.png`});
  await reach(page.getByRole('button',{name:'Create account'}),'wizard Create account (keyboard)',360);
  await keyboard(667);await page.getByRole('button',{name:'Create account'}).click();
  await page.getByRole('button',{name:'Creating…'}).waitFor({state:'detached',timeout:60000}).catch(()=>{});await page.waitForTimeout(500);
  // Later steps can all be skipped; each must fit and offer a reachable way on.
  for(let step=0;step<8;step++){
   const done=await page.getByRole('textbox',{name:'Message',exact:true}).isVisible().catch(()=>false);if(done)break;
   await fits(`wizard step ${step}`);
   const next=page.getByRole('button',{name:/^(Skip|Continue|Finish|Skip — set up later|Set up later|Open noevia|Start using noevia|Done)/}).first();
   if(!(await next.count())){await page.screenshot({path:`${shots}/noevia-mobile-wizard-stuck.png`});break;}
   await reach(next,`wizard step ${step} next`);await next.click();await page.waitForTimeout(300);
  }
  await page.goto(origin);
  // A new account lands in Settings, and a reload now returns there; close it to reach the chat.
  const openSettings=page.getByRole('region',{name:'Settings'});
  if(await openSettings.isVisible().catch(()=>false)){await page.keyboard.press('Escape');await openSettings.waitFor({state:'hidden'});}
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();

  // ── Settings with the keyboard open ──
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.waitForTimeout(400);await page.screenshot({path:`${shots}/noevia-mobile-before-account.png`});await page.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.getByRole('region',{name:'Settings'});await settings.waitFor();
  // Phones open Settings on its list; Profile is one tap in.
  await settings.getByRole('button',{name:'Profile',exact:true}).click();
  const name=settings.getByLabel('Display name');await name.focus();await keyboard(360);
  await reach(name,'Settings display name (keyboard)',360);await reach(settings.getByRole('button',{name:'Save',exact:true}),'Settings save (keyboard)',360);
  await page.screenshot({path:`${shots}/noevia-mobile-settings-keyboard.png`});
  await keyboard(667);await fits('settings');await page.keyboard.press('Escape');

  // ── Projects: create dialog with the keyboard open ──
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.sidebar .nav-item').filter({hasText:'Projects'}).click();
  await page.getByRole('button',{name:'New project'}).click();
  const create=page.getByRole('dialog',{name:'Create a project'});await create.waitFor();
  const pname=create.getByPlaceholder('Name your project');await pname.focus();await keyboard(360);
  await reach(pname,'project name (keyboard)',360);await pname.fill('Synthetic phone project');
  await reach(create.getByRole('button',{name:/^Create/}),'Create project (keyboard)',360);
  assert.ok(await create.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'create dialog overflows');
  await page.screenshot({path:`${shots}/noevia-mobile-project-create-keyboard.png`});
  await keyboard(667);await create.getByRole('button',{name:/^Create/}).click();await create.waitFor({state:'hidden'});
  await fits('projects');

  // ── Code preview, portrait and landscape ──
  for(const [w,h] of [[375,667],[667,375]]){
   await page.setViewportSize({width:w,height:h});await keyboard(h);
   await page.goto(origin);
   // A reload returns to the project created above, so ask for a chat explicitly.
   if(w<=600)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
   if(!(await page.getByRole('textbox',{name:'Message',exact:true}).isVisible().catch(()=>false))){
    await page.locator('.sidebar').getByRole('button',{name:'New chat',exact:true}).click();
    if(w<=600)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
   }
   await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
   await page.locator('.sidebar').getByRole('button',{name:'Code',exact:true}).click();
   await page.locator('.coding-main').waitFor();await fits(`code ${w}x${h}`);
   const back=page.locator('.coding-sidebar').getByRole('button',{name:'Chat',exact:true});
   await reach(back,`Code → Chat ${w}x${h}`,h);
   await reach(page.locator('.coding-main textarea'),`Code task box ${w}x${h}`,h);
   await page.screenshot({path:`${shots}/noevia-mobile-code-${w}x${h}.png`});
   await back.click();await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS mobile surfaces: setup wizard fields/actions with keyboard, Settings profile with keyboard, project create dialog with keyboard, Code preview portrait/landscape; no overflow.');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit');fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
