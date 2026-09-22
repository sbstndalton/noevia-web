// Projects page empty states (HIG empty states: what is missing, what to do, one action).
// Isolated real server, synthetic account created through the API, no inference.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const port=31288,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-projects-empty-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:1/v1',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 const cookies=new Map();
 const api=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}return {status:r.status,body:await r.json().catch(()=>null)};};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setup=await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'emptyqa',displayName:'Synthetic Empty QA',password:'synthetic projects empty password',diaryEnabled:false});
  assert.equal(setup.status,201,JSON.stringify(setup.body));
  assert.ok((await api('/api/profile/onboarding',{})).status<300);
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const openProjects=async()=>{await page.goto(origin);await page.waitForLoadState('networkidle');
   const nav=page.getByRole('button',{name:'Open navigation',exact:true});if(await nav.isVisible().catch(()=>false))await nav.click();
   await page.getByRole('button',{name:'Projects',exact:true}).first().click();await page.getByRole('heading',{name:'Projects',level:1}).waitFor();};
  for(const width of [375,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width<768?740:900});await page.emulateMedia({colorScheme:theme});
   await openProjects();
   const empty=page.locator('.empty-state-card').filter({hasText:'No projects yet'});await empty.waitFor();
   assert.match(await empty.innerText(),/A project keeps chats, files and instructions together\./);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width} ${theme}`);
   await page.screenshot({path:`${shots}/projects-empty-${width}-${theme}.png`});
   assert.equal(await page.getByRole('button',{name:'New project'}).count(),1,'one primary action when empty');
   await empty.getByRole('button',{name:'New project'}).click();
   await page.getByRole('dialog').first().waitFor();await page.keyboard.press('Escape');
  }
  assert.equal((await api('/api/projects',{name:'Synthetic battery notes',toolboxes:[]})).status<300,true);
  await page.setViewportSize({width:1440,height:900});await openProjects();
  await page.getByLabel('Filter projects').fill('zzz-nothing');
  const none=page.locator('.empty-state-card').filter({hasText:'No matching projects'});await none.waitFor();
  assert.match(await none.innerText(),/No project names or descriptions match “zzz-nothing”\./);
  await page.screenshot({path:`${shots}/projects-no-match-1440.png`});
  await none.getByRole('button',{name:'Clear filter'}).click();
  await page.getByText('Synthetic battery notes').first().waitFor();
  assert.equal(await page.getByLabel('Filter projects').inputValue(),'');
  assert.deepEqual(errors,[]);
  console.log('PASS projects empty: no-projects state with New project action, no-match state with Clear filter; 375/1440 light/dark, no overflow.');
 }finally{await browser.close();server.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
