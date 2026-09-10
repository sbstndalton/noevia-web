// Disposable real application server plus a synthetic completion endpoint.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31242',web=path.resolve(__dirname,'..');
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};
 },{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-reasoning-')),requests=[];let reasoningOnly=false, longStream=false;
 const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;
  if(req.url.endsWith('/models')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:'synthetic-model'}]}));}
  const body=JSON.parse(raw);requests.push(body);res.setHeader('Content-Type','text/event-stream');
  if(longStream){
   let chunk=0;const timer=setInterval(()=>{
    res.write('data: '+JSON.stringify({choices:[{delta:{content:('Synthetic reading paragraph '+(++chunk)+'. ').repeat(20)+'\n\n'}}]})+'\n\n');
    if(chunk===70){clearInterval(timer);res.end('data: [DONE]\n\n');}
   },60);res.on('close',()=>clearInterval(timer));return;
  }
  res.end('data: '+JSON.stringify({choices:[{delta:reasoningOnly?{reasoning_content:'Synthetic internal plan, not a final answer'}:{content:'Synthetic effort answer'}}]})+'\n\ndata: [DONE]\n\n');
 });await new Promise(r=>upstream.listen(31243,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31242',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:31243/v1',DIARY_BASE_URL:'http://127.0.0.1:1',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const admin=await browser.newPage();await admin.goto(origin);
  assert.equal((await api(admin,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic effort password',diaryEnabled:false})).status,201);
  await api(admin,'/api/profile/onboarding',{});
  assert.equal((await api(admin,'/api/reasoning-settings',{default:'high'},'PUT')).status,200);
  assert.equal((await api(admin,'/api/reasoning-settings',{default:'medium'},'PUT')).status,400);
  const project=(await api(admin,'/api/projects',{name:'Synthetic effort',model:'synthetic-model',toolboxes:[]})).body;
  assert.equal((await api(admin,'/api/reasoning-settings?projectId='+project.id)).body.effort,'high');
  await api(admin,'/api/projects/'+project.id+'/config',{reasoningEffort:'default'});
  assert.equal((await api(admin,'/api/reasoning-settings?projectId='+project.id)).body.effort,'default');
  await api(admin,'/api/projects/'+project.id+'/config',{reasoningEffort:null});
  const invitation=await api(admin,'/api/admin/invitations',{role:'member'});
  const member=await browser.newPage();await member.goto(origin);
  assert.equal((await api(member,'/api/auth/invitations/accept',{token:invitation.body.token,username:'memberqa',displayName:'Synthetic member',password:'synthetic effort password',diaryEnabled:false})).status,201);
  assert.equal((await api(member,'/api/reasoning-settings',{default:'low'},'PUT')).status,403);
  assert.equal((await api(member,'/api/reasoning-settings?projectId='+project.id)).status,404);
  assert.equal((await api(member,'/api/projects/'+project.id+'/config',{reasoningEffort:'low'})).status,404);
  await admin.reload();await admin.getByText('Synthetic effort',{exact:true}).first().click();
  await admin.getByRole('combobox',{name:'Thinking effort',exact:true}).selectOption('low');
  await admin.waitForFunction(()=>document.querySelector('select[aria-label="Thinking effort"]').value==='low'&&!document.querySelector('select[aria-label="Thinking effort"]').disabled);
  assert.equal((await api(admin,'/api/reasoning-settings?projectId='+project.id)).body.effort,'low');
  await admin.reload();await admin.getByText('Synthetic effort',{exact:true}).first().click();
  assert.equal(await admin.getByRole('combobox',{name:'Thinking effort',exact:true}).inputValue(),'low');
  for(const theme of ['light','dark'])for(const width of [375,768,1440]){
   await admin.setViewportSize({width,height:1000});await admin.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await admin.getByRole('combobox',{name:'Thinking effort',exact:true}).focus();
   assert.notEqual(await admin.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'none');
   if(process.env.QA_SCREENSHOTS)await admin.screenshot({path:`${process.env.QA_SCREENSHOTS}/effort-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
  }
  await admin.getByRole('combobox',{name:'Thinking effort',exact:true}).selectOption('high');
  await admin.waitForFunction(()=>document.querySelector('select[aria-label="Thinking effort"]').value==='high'&&!document.querySelector('select[aria-label="Thinking effort"]').disabled);
  await admin.locator('.composer-input').fill('Synthetic effort QA question');
  await admin.getByRole('button',{name:'Send',exact:true}).click();
  await admin.getByText('Synthetic effort answer',{exact:true}).waitFor();
  await admin.getByText('Effort: high · best-effort hint',{exact:true}).waitFor();
  assert.equal(requests.at(-1).max_tokens,8192);assert.equal(requests.at(-1).reasoning_effort,undefined);
  assert.equal(requests.at(-1).messages[0].content,'Think through this step by step before answering.');
  reasoningOnly=true;
  await admin.locator('.composer-input').fill('Synthetic reasoning-only regression');
  await admin.getByRole('button',{name:'Send',exact:true}).click();
  await admin.getByText('The model returned reasoning without a final answer. Try again or choose another model.',{exact:true}).waitFor();
  if(process.env.QA_SCREENSHOTS)await admin.screenshot({path:process.env.QA_SCREENSHOTS+'/reasoning-only.png',fullPage:true,animations:'disabled'});
  longStream=true;
  await admin.locator('.composer-input').fill('Synthetic scrolling regression');
  await admin.getByRole('button',{name:'Send',exact:true}).click();
  await admin.waitForFunction(()=>document.querySelector('.transcript')?.textContent.includes('paragraph 12.'));
  const transcript=admin.locator('.transcript');
  assert.ok(await transcript.evaluate(el=>el.scrollTop>0));
  await transcript.hover();await admin.mouse.wheel(0,-100000);
  await admin.waitForFunction(()=>document.querySelector('.transcript').scrollTop===0);
  await admin.waitForFunction(()=>document.querySelector('.transcript').textContent.includes('paragraph 30.'));
  assert.equal(await transcript.evaluate(el=>el.scrollTop),0,'ordinary chat must not pull the reader down');
  await transcript.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
  await admin.getByRole('button',{name:'Send',exact:true}).waitFor();
  assert.ok(await transcript.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<48));
  console.log('PASS ordinary chat streaming scroll opt-out/resume');
  console.log('PASS real-server reasoning defaults/overrides/validation/reload/member isolation and responsive composer controls');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
