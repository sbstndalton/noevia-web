// Settings → Personalization end to end: saved custom instructions reach the model's system
// message on the next chat request. Real server, synthetic account, a fake OpenAI-compatible
// upstream that records requests.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const port=31293,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';
(async()=>{
 const seen=[];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;
  if(req.url.endsWith('/chat/completions')){const body=JSON.parse(raw);seen.push(body);
   if(!body.stream){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({choices:[{message:{content:'Synthetic reply.'},finish_reason:'stop'}]}));}
   res.setHeader('Content-Type','text/event-stream');return res.end('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic reply.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
  res.setHeader('Content-Type','application/json');res.end('{"data":[]}');});
 await new Promise(r=>upstream.listen(31294,'127.0.0.1',r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-personalization-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31294/v1',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];const cookies=new Map();
 const api=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}const text=await r.text();return {status:r.status,text,body:(()=>{try{return JSON.parse(text);}catch{return null;}})()};};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal((await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'personalqa',displayName:'Synthetic Personal QA',password:'synthetic personalization password',diaryEnabled:false})).status,201);
  assert.ok((await api('/api/profile/onboarding',{})).status<300);
  assert.equal((await api('/api/account/instructions',{text:'x'.repeat(4001)},'PUT')).status,400);
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const [width,theme] of [[1440,'light'],[1440,'dark'],[768,'light'],[768,'dark'],[375,'light'],[375,'dark']]){
   await page.setViewportSize({width,height:width<768?760:900});await page.emulateMedia({colorScheme:theme});
   await page.goto(origin);await page.waitForLoadState('networkidle');
   await page.keyboard.press((await page.evaluate(()=>/mac/i.test(navigator.platform)))?'Meta+Comma':'Control+Comma');
   const dialog=page.getByRole('region',{name:'Settings'});await dialog.waitFor();
   await dialog.getByRole('button',{name:'Assistant & style',exact:true}).click();
   await dialog.getByRole('heading',{name:'Assistant & style',level:1}).waitFor();
   const box=dialog.getByLabel(/Custom instructions/);
   if(width===1440&&theme==='light'){
    assert.equal(await dialog.getByRole('button',{name:'Save',exact:true}).isDisabled(),true,'nothing to save yet');
    await box.fill('Answer in British English. PERSONAL-CANARY-7.');
    await dialog.getByText('Concise',{exact:true}).click();assert.equal(await dialog.getByRole('radio',{name:/Concise/}).isChecked(),true);
    await dialog.getByRole('button',{name:'Save',exact:true}).click();
    await dialog.getByRole('status').filter({hasText:'Saved.'}).waitFor();
   } else {await dialog.locator('textarea:enabled').first().waitFor();assert.equal(await box.inputValue(),'Answer in British English. PERSONAL-CANARY-7.','persists across reloads');assert.equal(await dialog.getByRole('radio',{name:/Concise/}).isChecked(),true);}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);
   await page.screenshot({path:`${shots}/personalization-${width}-${theme}.png`});
   // Memory has its own page (#228): one line per fact, each editable and forgettable.
   if(width<821)await dialog.getByRole('button',{name:'All settings'}).click();
   await dialog.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name:'Memory',exact:true}).click();
   await dialog.getByRole('heading',{name:'Memory',level:1}).waitFor();
   const list=dialog.getByRole('list',{name:'Account memory'});
   if(width===1440&&theme==='light'){
    await dialog.getByLabel('New memory').fill('I keep bees. MEMORY-CANARY-3');
    await dialog.getByRole('button',{name:'Remember'}).click();
    await dialog.getByRole('status').filter({hasText:'Remembered.'}).waitFor();
    await dialog.getByLabel('New memory').fill('Temporary line to forget');await dialog.getByRole('button',{name:'Remember'}).click();
    await list.getByText('Temporary line to forget').waitFor();
    await dialog.getByRole('button',{name:'Forget “Temporary line to forget”'}).click();
    await page.getByRole('dialog',{name:'Forget this line?'}).getByRole('button',{name:'Forget',exact:true}).click();
    await list.getByText('Temporary line to forget').waitFor({state:'detached'});
    await dialog.getByRole('switch',{name:'Use project memory'}).click();
    await dialog.getByRole('status').filter({hasText:'no longer sent'}).waitFor();
   }
   await list.getByText('I keep bees. MEMORY-CANARY-3').waitFor();
   assert.equal(await list.getByRole('listitem').count(),1,'one remembered line');
   assert.equal(await dialog.getByRole('switch',{name:'Use project memory'}).isChecked(),false);
   await page.screenshot({path:`${shots}/personalization-memory-${width}-${theme}.png`});
   await page.keyboard.press('Escape');
  }
  const project=(await api('/api/projects',{name:'Synthetic writing',model:'synthetic-model',toolboxes:[]})).body;
  assert.equal((await api(`/api/projects/${project.id}/config`,{memories:['PROJECT-MEMORY-CANARY']})).status,200);
  let chat=await api('/api/chat',{spaceId:project.id,projectId:project.id,chatId:'c-personal-1',message:'Hello',history:[]});
  assert.equal(chat.status,200,chat.text);
  const system=seen.filter(b=>b.stream).at(-1).messages.find(m=>m.role==='system');
  assert.match(system.content,/Keep replies short[\s\S]*PERSONAL-CANARY-7/);
  assert.match(system.content,/persistent memory[\s\S]*MEMORY-CANARY-3/);
  assert.doesNotMatch(system.content,/PROJECT-MEMORY-CANARY/,'project memory off');
  // Clearing removes them from the next request.
  assert.equal((await api('/api/account/instructions',{text:''},'PUT')).body.text,'');
  chat=await api('/api/chat',{spaceId:project.id,projectId:project.id,chatId:'c-personal-2',message:'Hello again',history:[]});
  assert.doesNotMatch(JSON.stringify(seen.filter(b=>b.stream).at(-1).messages),/PERSONAL-CANARY-7/);
  assert.equal((await api('/api/account/memory',{memories:[],useProjectMemories:true},'PUT')).status,200);
  chat=await api('/api/chat',{spaceId:project.id,projectId:project.id,chatId:'c-personal-3',message:'Third',history:[]});
  const third=JSON.stringify(seen.filter(b=>b.stream).at(-1).messages);
  assert.match(third,/PROJECT-MEMORY-CANARY/);assert.doesNotMatch(third,/MEMORY-CANARY-3/);
  assert.deepEqual(errors,[]);
  console.log('PASS personalization: custom instructions, response style and account memory (project memory switch honoured) saved in Settings, persist, reach the system message, clear removes them, 4000-char cap; 375/768/1440 light and dark.');
 }finally{await browser.close();server.kill('SIGTERM');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
