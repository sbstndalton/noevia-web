// The Chat/Cowork composer toggle (#236) and the tool catalogue (#237) on the real server with a
// synthetic project, a synthetic empty repository and no model. Screenshots at 375 and 1440 in
// light and dark. Synthetic data only.
// Run: PLAYWRIGHT_MODULE=<playwright-core> QA_SCREENSHOTS=<dir> node qa/composer-mode-catalogue.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const port=31436,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-mode-qa-'));
 const repo=path.join(dir,'demo-repo');fs.mkdirSync(repo);execFileSync('git',['init','-q'],{cwd:repo});
 fs.mkdirSync(shots,{recursive:true});
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',
  NOEVIA_FEATURE_CODE_HARNESS:'true',CODE_REPOS:`demo|${repo}`,INFERENCE_BASE_URL:'http://127.0.0.1:1/v1',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const errors=[];
 const cookies=new Map();
 const api=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}return {status:r.status,body:await r.json().catch(()=>null)};};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal((await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'modeqa',displayName:'Synthetic Mode QA',password:'synthetic mode qa password',diaryEnabled:false})).status,201);
  assert.ok((await api('/api/profile/onboarding',{})).status<300);
  const project=(await api('/api/projects',{name:'Cowork QA'})).body;
  // A saved Cowork session: the mode must come back from the chat record on reload.
  assert.ok((await api(`/api/projects/${project.id}/chats`,{chats:[{id:'c-modeqa',title:'Synthetic cowork session',updatedAt:Date.now(),mode:'cowork'}]})).status<300);
  const permitted=(await api(`/api/toolboxes/permitted?projectId=${project.id}&mode=cowork`)).body;
  assert.equal(permitted.boxes.find(b=>b.id==='code').state,'available');
  const me=(await api('/api/profile')).body;
  for(const width of [375,1440]) for(const scheme of ['light','dark']){
   const ctx=await browser.newContext({viewport:{width,height:width<500?812:900},colorScheme:scheme});
   await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
   await ctx.addInitScript(([user,pid])=>{localStorage.setItem('noevia:last-view',JSON.stringify({user,view:{kind:'chat',chatId:'c-modeqa',projectId:pid},settings:null}));},[me?.user?.id||me?.id||null,project.id]);
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin);
   const group=page.getByRole('radiogroup',{name:'Session mode'});await group.waitFor({timeout:15000});
   await page.getByRole('radio',{name:'Cowork'}).and(page.locator('[aria-checked="true"]')).waitFor({timeout:10000});
   await page.getByText(/Runs a coding task in/).waitFor();
   await page.screenshot({path:`${shots}/composer-toggle-${width}-${scheme}.png`});
   await page.getByRole('button',{name:/^Tools/}).click();
   const list=page.getByRole('listbox',{name:'Tools'});await list.waitFor();
   await page.getByRole('combobox').fill('co');
   await page.keyboard.press('ArrowDown');
   assert.ok(await page.getByRole('option').count()>0);
   await page.screenshot({path:`${shots}/composer-catalogue-${width}-${scheme}.png`});
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  console.log('composer mode/catalogue QA passed; screenshots in',shots);
 }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
