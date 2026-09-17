// D10 end to end through the UI: a project chat with the Diary box, a model that asks for
// diary_append, the approval card with full arguments, Allow once, and the note landing in
// today's entry of a per-run copy of diary-test served by the real Diary sidecar.
// Synthetic account, fake model upstream; diary-test itself is checked to be unchanged.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const PORT=31401,UPSTREAM=31402,INTERNAL=31403,DIARY=31404,origin=`http://127.0.0.1:${PORT}`;
const web=path.resolve(__dirname,'..'),diarySvc=path.resolve(web,'../../services/diary'),source=path.resolve(web,'../../../diary-test');
const shots=process.env.QA_SCREENSHOTS||os.tmpdir();
const NOTE='Synthetic QA note: watered the tomatoes. APPEND-CANARY-41';

function treeHash(dir){const h=crypto.createHash('sha256');const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else h.update(path.relative(dir,p)).update(fs.readFileSync(p));}};walk(dir);return h.digest('hex');}
const waitFor=async(url)=>{for(let i=0;i<300;i++){try{const r=await fetch(url);if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(`not up: ${url}`);};

(async()=>{
 const before=treeHash(source);
 const run=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-diary-append-ui-'));
 const requests=[];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;
  if(!req.url.endsWith('/chat/completions')){res.setHeader('Content-Type','application/json');return res.end('{"data":[]}');}
  const body=JSON.parse(raw);requests.push(body);
  const offersAppend=(body.tools||[]).some(t=>t.function?.name==='diary_append');
  const answered=body.messages.some(m=>m.role==='tool');
  const delta=offersAppend&&!answered
   ?{tool_calls:[{index:0,id:'call_append_1',type:'function',function:{name:'diary_append',arguments:JSON.stringify({text:NOTE,title:'Garden',timezone:'UTC'})}}]}
   :{content:answered?'Added it to today\'s entry.':'Synthetic reply.'};
  const finish=delta.tool_calls?'tool_calls':'stop';
  if(!body.stream){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({choices:[{message:{role:'assistant',...delta},finish_reason:finish}]}));}
  res.setHeader('Content-Type','text/event-stream');
  res.end(`data: ${JSON.stringify({choices:[{delta:{role:'assistant',...delta},finish_reason:finish}]})}\n\ndata: [DONE]\n\n`);});
 await new Promise(r=>upstream.listen(UPSTREAM,'127.0.0.1',r));
 const diaryState=path.join(run,'diary');fs.mkdirSync(diaryState,{recursive:true});
 const sidecar=spawn(path.join(diarySvc,'.venv/bin/python'),['-m','uvicorn','agent.app:app','--host','127.0.0.1','--port',String(DIARY)],{cwd:diarySvc,stdio:['ignore','ignore',fs.openSync(path.join(run,'sidecar.log'),'w')],env:{...process.env,CORPUS_BACKEND:'local',CORPUS_LOCAL_ROOT:path.join(run,'legacy-empty'),DB_PATH:path.join(diaryState,'index.db'),DIARY_AUTH_TOKEN:'synthetic-only'}});
 const ui=path.join(run,'ui');
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:['ignore','ignore',fs.openSync(path.join(run,'web.log'),'w')],env:{...process.env,UI_DATA_DIR:ui,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:`http://127.0.0.1:${UPSTREAM}/v1`,DIARY_BASE_URL:`http://127.0.0.1:${DIARY}`,DIARY_AUTH_TOKEN:'synthetic-only',MCP_INTERNAL_PORT:String(INTERNAL),MCP_SERVERS:`noevia|http://127.0.0.1:${INTERNAL}/mcp|internal`,MCP_SERVER_URL:'',NOEVIA_FEATURE_DIARY_MCP_WRITE:'true'}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];const cookies=new Map();
 const api=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}const text=await r.text();return {status:r.status,text,body:(()=>{try{return JSON.parse(text);}catch{return null;}})()};};
 try{
  await waitFor(`http://127.0.0.1:${DIARY}/health`);await waitFor(origin+'/api/setup/status');
  for(let i=0;i<100&&!fs.existsSync(path.join(ui,'first-run-setup-code'));i++)await new Promise(r=>setTimeout(r,50));
  assert.equal((await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(ui,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'appendqa',displayName:'Synthetic Append QA',password:'synthetic append password',diaryEnabled:true})).status,201);
  const user=(await api('/api/auth/session')).body.user;
  // The per-run corpus copy becomes this tenant's local corpus before the Diary is first touched.
  const corpus=path.join(diaryState,'users',user.id.toLowerCase(),'corpus');
  fs.mkdirSync(path.dirname(corpus),{recursive:true});fs.cpSync(source,corpus,{recursive:true});
  assert.ok((await api('/api/profile/onboarding',{})).status<300);
  const project=(await api('/api/projects',{name:'Synthetic garden',model:'synthetic-model',toolboxes:['diary']})).body;
  assert.ok(project?.id,'project created');

  const ctx=await browser.newContext({viewport:{width:1440,height:900}});await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForLoadState('networkidle');
  await page.getByRole('button',{name:'Open Synthetic garden',exact:true}).click();
  const box=page.getByRole('textbox').first();
  try{await box.waitFor({timeout:8000});}catch(e){await page.screenshot({path:`${shots}/diary-append-ui-debug.png`});console.log(await page.getByRole('textbox').evaluateAll(n=>n.map(x=>x.getAttribute('aria-label')||x.getAttribute('placeholder'))));throw e;}
  await box.fill('Please note in my diary that I watered the tomatoes.');await box.press('Enter');
  const allow=page.getByRole('button',{name:'Allow once'});await allow.waitFor({timeout:20000});
  const card=page.locator('.tool-approval').last();
  assert.match(await card.innerText(),/APPEND-CANARY-41/,'full arguments on the card');
  await page.screenshot({path:`${shots}/diary-append-ui-approval.png`});
  await allow.click();
  await page.getByText("Added it to today's entry.").waitFor({timeout:20000});
  await page.screenshot({path:`${shots}/diary-append-ui-done.png`});

  const entries=[];const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.md'))entries.push(p);}};walk(path.join(corpus,'Entries'));
  const hits=entries.filter(p=>fs.readFileSync(p,'utf8').includes('APPEND-CANARY-41'));
  const today=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
  assert.equal(hits.length,1,`note in exactly one entry file (found ${hits.map(p=>path.relative(corpus,p))})`);
  assert.equal(path.basename(hits[0]),`${today}.md`,`note in today's entry: ${path.relative(corpus,hits[0])}`);
  assert.equal(requests.filter(b=>b.messages.some(m=>m.role==='tool')).length,1,'one follow-up model round after the approved call');
  assert.equal(treeHash(source),before,'diary-test itself unchanged');
  assert.deepEqual(errors,[]);
  console.log(`PASS diary append UI: approval card with full arguments, Allow once, note appended to today's entry (${path.relative(corpus,hits[0])}) in a per-run copy through the real sidecar; diary-test unchanged.`);
 }finally{await browser.close();server.kill('SIGTERM');sidecar.kill('SIGTERM');await new Promise(r=>upstream.close(r));if(process.env.QA_KEEP_RUN)console.log('run dir',run);else fs.rmSync(run,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
