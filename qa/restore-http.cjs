// Whole-stack synthetic backup/restore. Never mounts production state or calls a real provider.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn,spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../../..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-restore-http-'));
const origin='http://localhost:31285',diary='http://127.0.0.1:31284',provider='http://127.0.0.1:31283/v1';
let providerCalls=0,privateKeyCalls=0,web,companion;
const fake=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};providerCalls++;
 if(req.headers.authorization==='Bearer synthetic-restore-key')privateKeyCalls++;
 res.setHeader('Content-Type','application/json');
 if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'synthetic-main'},{id:'synthetic-embed'}]}));
 if(req.url.endsWith('/embeddings'))return res.end(JSON.stringify({data:(Array.isArray(body.input)?body.input:[body.input]).map((_,index)=>({index,embedding:[1,0,0]}))}));
 const prompt=String(body.messages?.at(-1)?.content||'');
 const content=prompt.includes('Verdict (LOG or SKIP)')?'LOG':prompt.includes('biographer')?'The companion recorded the synthetic restore test.':prompt.includes('UPDATE or NO')?'NO':'Synthetic restored provider reply.\n[LOG: ok]';
 const usage={prompt_tokens:10,completion_tokens:8,total_tokens:18};
 if(body.stream){res.setHeader('Content-Type','text/event-stream');return res.end('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage})+'\n\ndata: [DONE]\n\n');}
 res.end(JSON.stringify({choices:[{message:{role:'assistant',content},finish_reason:'stop'}],usage}));
});
function client(){const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{
 const response=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});
 for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{}return{status:response.status,text,body:value};
};}
async function wait(url){for(let i=0;i<200;i++){try{const r=await fetch(url,{headers:{Authorization:'Bearer synthetic-diary-token'}});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Synthetic service did not start');}
async function start(state){
 for(const name of ['web','diary','diary/corpus'])fs.mkdirSync(path.join(state,name),{recursive:true});
 const log=fs.openSync(path.join(root,'services.log'),'a');
 companion=spawn(path.join(repo,'services/diary/.venv/bin/python'),['-m','uvicorn','agent.app:app','--host','127.0.0.1','--port','31284'],{cwd:path.join(repo,'services/diary'),stdio:['ignore',log,log],env:{...process.env,DIARY_CONFIG:path.join(repo,'services/diary/config/config.yaml'),CORPUS_BACKEND:'local',CORPUS_LOCAL_ROOT:path.join(state,'diary/corpus'),CORPUS_ROOT:'',DB_PATH:path.join(state,'diary/index.db'),DIARY_AUTH_TOKEN:'synthetic-diary-token',DIARY_LEGACY_USER_ID:'',DIARY_LOCAL_VOLUMES:'',LLM_BASE_URL:provider,LLM_API_KEY:'',LLM_CHAT_MODEL:'synthetic-main',LLM_EMBED_MODEL:'synthetic-embed',LLM_AUX_BASE_URL:provider,LLM_AUX_API_KEY:'',LLM_AUX_MODEL:'synthetic-main'}});
 await wait(diary+'/api/health');
 web=spawn(process.execPath,['server/index.cjs'],{cwd:path.join(repo,'apps/web'),stdio:['ignore',log,log],env:{...process.env,UI_DATA_DIR:path.join(state,'web'),UI_PORT:'31285',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:provider,INFERENCE_API_KEY:'',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:diary,DIARY_AUTH_TOKEN:'synthetic-diary-token',DIARY_LEGACY_USER_ID:'',DIARY_LOCAL_VOLUMES:'',CORPUS_BACKEND:'local',WEBDAV_BASE_URL:'',WEBDAV_USERNAME:'',WEBDAV_PASSWORD:'',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 await wait(origin+'/api/setup/status');fs.closeSync(log);
}
async function stop(){for(const child of [web,companion])if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}web=companion=null;}
function tar(args){const result=spawnSync('tar',args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}
(async()=>{
 await new Promise(r=>fake.listen(31283,'127.0.0.1',r));
 const original=path.join(root,'original'),restored=path.join(root,'restored');
 try{
  await start(original);let api=client();
  let r=await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(original,'web/first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'restoreqa',displayName:'Synthetic Restore QA',password:'synthetic restore password',diaryEnabled:true});assert.equal(r.status,201,r.text);
  await api('/api/profile/onboarding',{});
  r=await api('/api/providers',{label:'Synthetic encrypted provider',baseUrl:provider,apiKey:'synthetic-restore-key',defaultModel:'synthetic-main'});assert.equal(r.status,200,r.text);const providerId=r.body.id;
  r=await api('/api/projects',{name:'Synthetic restore project',provider:providerId,model:'synthetic-main',files:[],toolboxes:[]});assert.equal(r.status,200,r.text);const projectId=r.body.id;
  const d=new Date(),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const exchange=message=>api('/api/chat',{spaceId:'diary',message,history:[],exchangeId:require('crypto').randomUUID(),sessionId:'synthetic-restore-session',entryDay:day,entryTime:new Date().toISOString()});
  r=await exchange('SYNTHETIC-FIRST-RESTORE: I finished a disposable software test today.');assert.equal(r.status,200,r.text);assert.match(r.text,/Synthetic restored provider reply/);assert.match(r.text,/"decision"\s*:\s*"logged"/);
  const before=(await api('/api/diary/today?month='+day.slice(0,7))).text;assert.match(before,/SYNTHETIC-FIRST-RESTORE/);
  await stop();
  const archive=path.join(root,'synthetic-state.tar.gz');tar(['-czf',archive,'-C',original,'web','diary']);
  const names=tar(['-tzf',archive]).split('\n').filter(Boolean);assert.ok(names.every(name=>!name.startsWith('/')&&!name.split('/').includes('..')));
  fs.mkdirSync(restored);tar(['-xzf',archive,'-C',restored]);
  assert.deepEqual(fs.readFileSync(path.join(original,'web/secrets.key')),fs.readFileSync(path.join(restored,'web/secrets.key')));
  await start(restored);api=client();r=await api('/api/auth/login/password',{username:'restoreqa',password:'synthetic restore password'});assert.equal(r.status,200,r.text);
  r=await api('/api/diary/today?month='+day.slice(0,7));assert.match(r.text,/SYNTHETIC-FIRST-RESTORE/);
  const callsBefore=privateKeyCalls;
  r=await api('/api/chat',{spaceId:projectId,projectId,chatId:'synthetic-restored-chat',message:'Synthetic provider credential verification.',history:[]});assert.equal(r.status,200,r.text);assert.match(r.text,/Synthetic restored provider reply/);assert.ok(privateKeyCalls>callsBefore,'restored provider credential decrypted and reached the synthetic provider');
  r=await exchange('SYNTHETIC-SECOND-RESTORE: I verified recovery in a disposable folder.');assert.match(r.text,/"decision"\s*:\s*"logged"/);
  r=await api('/api/diary/today?month='+day.slice(0,7));assert.match(r.text,/SYNTHETIC-FIRST-RESTORE/);assert.match(r.text,/SYNTHETIC-SECOND-RESTORE/);
  r=await api('/api/diary/file',{path:'AI Memory/restore-check.md'});const initial=r.body;
  r=await api('/api/diary/file',{...initial,content:'Synthetic version one'},'PUT');assert.equal(r.status,200,r.text);
  r=await api('/api/diary/file',{...initial,content:'Stale synthetic replacement'},'PUT');assert.equal(r.status,409,r.text);
  console.log(JSON.stringify({result:'PASS',services:'real web and Diary',provider:'synthetic HTTP only',restoredLogin:true,restoredCorpus:true,continuedCapture:true,encryptedProviderCredential:true,staleWriteRejected:true,providerCalls}));
 }finally{await stop();await new Promise(r=>fake.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
