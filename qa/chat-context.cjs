// Disposable real application server plus a synthetic completion endpoint.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31259',web=path.resolve(__dirname,'..');
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};
 },{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-context-')),requests=[];let failSummary=false,failStream=false;
 const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
  res.setHeader('Content-Type','application/json');
  if(req.url.includes('health'))return res.end(JSON.stringify({all_models_loaded:[{loaded:true,model_name:'synthetic-model',recipe_options:{ctx_size:32768}}]}));
  if(req.url.includes('models'))return res.end(JSON.stringify({data:[{id:'synthetic-model'}]}));
  if(!req.url.endsWith('/chat/completions'))return res.end('{}');
  requests.push(body);assert.ok(body.max_tokens>0 && body.max_tokens<=4096);
  if(!body.stream){assert.equal(body.tools,undefined);if(failSummary){res.statusCode=503;return res.end('{}');}return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'User wants synthetic constraints preserved. Dates and figures remain unverified. No tools executed.'}}]}));}
  res.setHeader('Content-Type','text/event-stream');
  if(failStream)return res.end('data: '+JSON.stringify({error:{message:'Context size has been exceeded.'}})+'\n\n');
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic answer.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });await new Promise(r=>upstream.listen(31260,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31259',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31260',MODEL_MANAGER_BASE_URL:'http://127.0.0.1:31260',MODEL_MANAGER_KIND:'lemonade',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const page=await browser.newPage();await page.goto(origin);
  assert.equal((await api(page,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic context password',diaryEnabled:false})).status,201);
  const created=await api(page,'/api/projects',{name:'Synthetic Context',model:'synthetic-model',toolboxes:['core']}),project=created.body.project||created.body;
  assert.ok(project.id,JSON.stringify(created));
  const history=Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',content:'Turn '+i+': synthetic facts. '+('Historical context. '.repeat(80))}));
  await api(page,`/api/projects/${project.id}/chats`,{chats:[{id:'context-qa',title:'Context QA'}]});
  await api(page,'/api/chats/context-qa/history',{history});
  await api(page,'/api/profile/onboarding',{});await page.reload();await page.getByRole('button',{name:'Open Synthetic Context',exact:true}).waitFor();const expand=page.getByRole('button',{name:'Expand chats in Synthetic Context',exact:true});if(await expand.isVisible())await expand.click();await page.getByRole('button',{name:'Context QA',exact:true}).first().click();
  await page.getByText('Context window',{exact:true}).click();
  await page.getByRole('button',{name:'Compact chat',exact:true}).click();
  await page.getByText('Compacted. Full transcript retained.',{exact:false}).waitFor();
  const meter=(await api(page,'/api/chats/context-qa/context-window')).body.meter;assert.equal(meter.covered,8);assert.equal(meter.limit,32768);
  assert.deepEqual((await api(page,'/api/chats/context-qa/history')).body.history,history);
  for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);await page.screenshot({path:'/tmp/noevia-context-'+width+'.png'});}
  await page.getByRole('button',{name:/Switch to Polymetal/}).click();await page.screenshot({path:'/tmp/noevia-context-light.png'});
  const chat=async(body)=>page.evaluate(async body=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return r.text();},body);
  const normal=await chat({spaceId:project.id,projectId:project.id,chatId:'context-qa',message:'Continue',history});assert.ok(normal.includes('Synthetic answer.'));assert.ok(requests.at(-1).messages.some(m=>m.content.includes('Earlier conversation summary')));
  const big=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'Synthetic record '+i+' '+('Fact. '.repeat(700))}));
  const auto=await chat({spaceId:project.id,projectId:project.id,chatId:'auto-qa',message:'Continue',history:big});assert.ok(auto.includes('Compacting older messages'));assert.ok(auto.includes('Synthetic answer.'),auto);
  failSummary=true;const failed=await chat({spaceId:project.id,projectId:project.id,chatId:'failure-qa',message:'',compactOnly:true,history});assert.ok(failed.includes('Compaction failed'));assert.equal((await api(page,'/api/chats/failure-qa/context-window')).body.meter,null);
  failSummary=false;failStream=true;const error=await chat({spaceId:project.id,projectId:project.id,chatId:'context-qa',message:'Continue',history});assert.ok(error.includes('ran out of context space'));
  console.log('PASS manual UI, automatic compaction, transcript retention, prefix reuse, bounded requests, failed summary and streamed context errors; responsive screenshots saved');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
