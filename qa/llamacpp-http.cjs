// Real HTTP regression: cold model selection must load before budgeting.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const origin='http://localhost:31326',dir=fs.mkdtempSync(path.join(os.tmpdir(),'model-context-http-'));
let loaded='smart',allocation=131072,fail=false,failClassifier=false;const calls=[],cookies=new Map();
const health=()=>({version:'synthetic-1',all_models_loaded:[{model_name:loaded,loaded:true,recipe_options:{ctx_size:loaded==='fast'?allocation:32768}}]});
const upstream=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');calls.push(req.url);
 if(req.url.startsWith('/props')){assert.equal(new URL(req.url,'http://fixture').searchParams.get('autoload'),'false');return res.end(JSON.stringify({default_generation_settings:{n_ctx:loaded==='fast'?allocation:32768},total_slots:4,build_info:'b10920-synthetic'}));}
 if(req.url.endsWith('/load')){if(fail){res.statusCode=503;return res.end('{}');}loaded=body.model;return res.end('{}');}
 if(req.url==='/models'||req.url==='/models?reload=1')return res.end(JSON.stringify({data:['fast','smart'].map(id=>({id,source:'preset',can_remove:false,status:{value:id===loaded?'loaded':'unloaded',args:['PRIVATE_CANARY']},meta:{n_ctx_train:262144}}))}));
 if(req.url==='/models/unload'){loaded='';return res.end('{}');}
 if(req.url==='/models' && req.method==='POST')return res.end('{}');
 if(req.url.endsWith('/chat/completions')){
  if(!body.stream){if(failClassifier){res.statusCode=503;return res.end('{}');}return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'FAST'}}]}));}
  assert.equal(loaded,body.model);res.setHeader('Content-Type','text/event-stream');
  return res.end('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic answer.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 }
 res.end('{}');
});
async function api(url,body,method=body===undefined?'GET':'POST'){
 const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});
 for(const value of r.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
 const text=await r.text();return {status:r.status,text,body:(()=>{try{return JSON.parse(text);}catch{return null;}})()};
}
const meter=r=>r.text.split('\n').filter(x=>x.startsWith('data: ')).map(x=>{try{return JSON.parse(x.slice(6));}catch{return {};}}).find(x=>x.type==='context');
(async()=>{
 fs.writeFileSync(path.join(dir,'models.ini'),'version = 1\n[fast]\nc = 131072\nmodel = /models/synthetic.gguf\n');
 await new Promise(r=>upstream.listen(31327,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31326',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31327',MODEL_MANAGER_BASE_URL:'http://127.0.0.1:31327',MODEL_MANAGER_KIND:'llamacpp',LLAMACPP_PRESET_PATH:path.join(dir,'models.ini'),MCP_SERVERS:'',MCP_SERVER_URL:''}});
 try{
  for(let i=0;i<100;i++){try{if((await api('/api/setup/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setup=await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'contextqa',displayName:'Synthetic Context QA',password:'synthetic allocation test password',diaryEnabled:false});assert.equal(setup.status,201,setup.text);
  const created=await api('/api/projects',{name:'Synthetic cold model',model:'fast',toolboxes:[]});const project=created.body.project||created.body;assert.ok(project.id,created.text);
  const chat=()=>api('/api/chat',{spaceId:project.id,projectId:project.id,chatId:'cold-qa',message:'Hello',history:[]});
  calls.length=0;loaded='smart';let result=await chat();assert.equal(meter(result)?.limit,131072,result.text);assert.ok(result.text.includes('Synthetic answer.'));
  assert.ok(calls.indexOf('/models/load')<calls.indexOf('/v1/chat/completions'),JSON.stringify(calls));
  allocation=32768;result=await chat();assert.equal(meter(result)?.limit,32768,result.text);
  await api('/api/auto-roles',{fast:'fast',smart:'smart'},'PUT');
  const loadsBefore=calls.filter(c=>c==='/models/load').length;await new Promise(r=>setTimeout(r,100));assert.equal(calls.filter(c=>c==='/models/load').length,loadsBefore,'native roles must not warm multiple models');
  const autoCreated=await api('/api/projects',{name:'Synthetic automatic model',model:'fast',routing:'auto',toolboxes:[]});const autoProject=autoCreated.body.project||autoCreated.body;
  loaded='smart';allocation=131072;failClassifier=true;
  result=await api('/api/chat',{spaceId:autoProject.id,projectId:autoProject.id,chatId:'auto-qa',message:'Hello',history:[]});
  assert.equal(meter(result)?.model,'fast',result.text);assert.equal(meter(result)?.limit,131072,result.text);failClassifier=false;
  // Roles naming a model the engine no longer serves: clear 409 before any engine call, and settings name the role.
  await api('/api/auto-roles',{fast:'gone-model',smart:'smart'},'PUT');
  assert.deepEqual((await api('/api/auto-roles')).body.missing,[{role:'fast',model:'gone-model'}]);
  calls.length=0;result=await api('/api/chat',{spaceId:autoProject.id,projectId:autoProject.id,chatId:'auto-stale',message:'Hello',history:[]});
  assert.equal(result.status,409,result.text);assert.match(result.body.error,/Fast \(gone-model\)/);assert.ok(!calls.some(c=>c.endsWith('/chat/completions')),JSON.stringify(calls));
  await api('/api/auto-roles',{fast:'fast',smart:'smart'},'PUT');assert.deepEqual((await api('/api/auto-roles')).body.missing,[]);
  loaded='smart';fail=true;result=await chat();assert.ok(result.text.includes('could not load'),result.text);assert.equal(meter(result),undefined);
  fail=false;
  assert.equal((await api('/api/models/capabilities')).body.kind,'llamacpp');
  assert.equal((await fetch(origin+'/api/models/preset?model=fast')).status,401);
  const invite=await api('/api/admin/invitations',{role:'member'});
  const memberCookies=new Map();
  async function member(url,body,method=body===undefined?'GET':'POST'){
    const r=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:[...memberCookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(memberCookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});
    for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');memberCookies.set(p.slice(0,i),p.slice(i+1));}
    return {status:r.status,body:await r.json()};
  }
  assert.equal((await member('/api/auth/invitations/accept',{token:invite.body.token,username:'native-member',displayName:'Synthetic member',password:'synthetic native member password',diaryEnabled:false})).status,201);
  assert.equal((await member('/api/models/preset?model=fast')).status,403);
  assert.equal((await member('/api/models/preset',{},'PUT')).status,403);
  assert.equal((await member('/api/models/load',{name:'fast'})).status,403);
  assert.equal((await member('/api/models/installed')).status,200);

  const installed=await api('/api/models/installed');assert.ok(!installed.text.includes('PRIVATE_CANARY'));assert.equal(installed.body[0].canDelete,false);
  const profile=await api('/api/models/preset?model=fast');assert.equal(profile.status,200,profile.text);
  const update={model:'fast',baseRevision:profile.body.revision,options:{'ctx-size':'32768'},confirmReload:true};
  assert.equal((await api('/api/models/preset',update,'PUT')).status,409);
  loaded='';assert.equal((await api('/api/models/preset',update,'PUT')).status,200);
  assert.equal((await api('/api/models/preset',update,'PUT')).status,409);
  assert.match(fs.readFileSync(path.join(dir,'models.ini'),'utf8'),/ctx-size = 32768/);
  assert.equal((await api('/api/models/load',{name:'fast',mtp:true})).status,400);
  console.log('PASS native profiles/status/capabilities/privacy; real HTTP cold model load → correct 128k budget; auto routing to cold fast model; stale roles → 409; changed live 32k overrides remembered 128k; failed load blocks generation.');
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
