// Synthetic real-server lifecycle and context tests; KEEP_QA=1 leaves a browser fixture.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const origin='http://localhost:31279',dir=fs.mkdtempSync(path.join(os.tmpdir(),'instruction-skills-http-'));
const requests=[];let readSkill=false;
const upstream=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');
 if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'synthetic'}]}));
 if(req.url.endsWith('/embeddings'))return res.end(JSON.stringify({data:(Array.isArray(body.input)?body.input:[body.input]).map((_,index)=>({index,embedding:[1,0,0]}))}));
 if(req.url.endsWith('/chat/completions')){
  requests.push(body);res.setHeader('Content-Type','text/event-stream');
  const hasRead=body.messages.some(m=>m.role==='tool');
  const delta=readSkill&&!hasRead?{tool_calls:[{index:0,id:'skill-read',type:'function',function:{name:'read_project_file',arguments:JSON.stringify({name:'review.md'})}}]}:{content:'Synthetic review complete.'};
  return res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:delta.tool_calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
 }
 res.end('{}');
});
function client(){const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{
 const response=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});
 for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{}return{status:response.status,text,body:value};
};}
(async()=>{
 await new Promise(r=>upstream.listen(31280,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31279',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31280',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 try{
  const api=client();for(let i=0;i<100;i++){try{if((await api('/api/setup/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  let r=await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'skillqa',displayName:'Synthetic Skill QA',password:'synthetic skill review password',diaryEnabled:false});assert.equal(r.status,201,r.text);
  await api('/api/profile/onboarding',{});
  const content='---\nname: Weekly review\ndescription: Summarize decisions and next actions\nversion: 1\nrequires: core, nextcloud-notes\n---\nSKILL-BODY-CANARY: Draft a review citing only the selected notes. Propose saving through the normal approval gate.';
  r=await api('/api/projects',{name:'Synthetic instruction skills',model:'synthetic',toolboxes:['core'],files:[{name:'review.md',content},{name:'notes.txt',content:'SYNTHETIC-NOTES: A decision and two next actions.'}]});assert.equal(r.status,200,r.text);const project=r.body;
  const route=`/api/projects/${project.id}/instruction-skills`;
  r=await api(route);assert.equal(r.body.skills[0].status,'review');const hash=r.body.skills[0].hash;
  const chat=()=>api('/api/chat',{spaceId:project.id,projectId:project.id,chatId:'skills-'+Date.now(),message:'Review the notes.',history:[]});
  requests.length=0;await chat();assert.ok(!JSON.stringify(requests).includes('SKILL-BODY-CANARY'));assert.ok(JSON.stringify(requests).includes('SYNTHETIC-NOTES'));
  r=await api(route,{file:'review.md',hash:'stale',enabled:true},'PUT');assert.equal(r.status,409);
  r=await api(route,{file:'review.md',hash,enabled:true},'PUT');assert.equal(r.status,200,r.text);assert.equal(r.body.skills[0].status,'enabled');
  requests.length=0;readSkill=true;r=await chat();assert.ok(r.text.includes('Loaded instruction skill'),r.text);assert.ok(JSON.stringify(requests).includes('SKILL-BODY-CANARY'));
  r=await api(route,{file:'review.md',enabled:false},'PUT');assert.equal(r.body.skills[0].status,'disabled');
  requests.length=0;r=await chat();assert.ok(!JSON.stringify(requests).includes('SKILL-BODY-CANARY'));assert.ok(r.text.includes('disabled'),r.text);
  await api(route,{file:'review.md',hash,enabled:true},'PUT');
  await api(`/api/projects/${project.id}/config`,{files:[{name:'review.md',content:content+'\nVersion changed.'},{name:'notes.txt',content:'SYNTHETIC-NOTES'}]});
  r=await api(route);assert.equal(r.body.skills[0].status,'updated');
  const invite=await api('/api/admin/invitations',{role:'member'});const other=client();
  r=await other('/api/auth/invitations/accept',{token:invite.body.token,username:'skillother',displayName:'Other synthetic user',password:'synthetic other account password',diaryEnabled:false});assert.ok(r.status<300,r.text);
  assert.equal((await other(route)).status,404);assert.equal((await other(route,{file:'review.md',hash,enabled:true},'PUT')).status,404);
  console.log('PASS: real HTTP review/enable/disable/update, stale-hash 409, full handler source exclusion and tool loading, guessed disabled read blocked, tenant isolation.');
  if(process.env.KEEP_QA==='1'){console.log('Browser fixture: '+origin+' — skillqa / synthetic skill review password — project '+project.id);await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
