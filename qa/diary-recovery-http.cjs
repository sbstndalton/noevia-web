// Synthetic Diary recovery integration; mock companion, no real corpus or inference. KEEP_QA=1 leaves a browser fixture.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const origin='http://localhost:31279',dir=fs.mkdtempSync(path.join(os.tmpdir(),'instruction-skills-http-'));
const requests=[];let readSkill=false;
const upstream=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');
 if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:'synthetic'}]}));
 if(req.url.endsWith('/embeddings'))return res.end(JSON.stringify({data:(Array.isArray(body.input)?body.input:[body.input]).map((_,index)=>({index,embedding:[1,0,0]}))}));
 if(req.url.endsWith('/chat/completions')){res.setHeader('Content-Type','text/event-stream');return res.end('data: '+JSON.stringify({type:'answer',text:'Recovered synthetic companion reply.'})+'\n\ndata: '+JSON.stringify({type:'diary',decision:'logged',xid:'synthetic-xid'})+'\n\ndata: {"type":"done"}\n\n');}
 if(req.url.startsWith('/api/files'))return res.end(JSON.stringify({files:[]}));
 if(req.url.startsWith('/api/months'))return res.end(JSON.stringify({months:[]}));
 res.end('{}');
});
function client(){const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{
 const response=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});
 for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{}return{status:response.status,text,body:value};
};}
(async()=>{
 await new Promise(r=>upstream.listen(31280,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31279',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31280',DIARY_BASE_URL:'http://127.0.0.1:31280',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 try{
  const api=client();for(let i=0;i<100;i++){try{if((await api('/api/setup/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  let r=await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'skillqa',displayName:'Synthetic Skill QA',password:'synthetic skill review password',diaryEnabled:true});assert.equal(r.status,201,r.text);
  await api('/api/profile/onboarding',{});
  const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'}),route='/api/diary/exchanges?day='+day;
  const body={spaceId:'diary',entryDay:day,exchangeId:'synthetic-recovery-123456',message:'SYNTHETIC-RECOVERABLE-MESSAGE',history:[]};
  r=await api('/api/chat',body);assert.equal(r.status,200,r.text);assert.match(r.text,/Recovered synthetic/);
  r=await api(route);assert.equal(r.body.exchanges.length,1);assert.equal(r.body.exchanges[0].state,'complete');assert.equal(r.body.exchanges[0].content,'Recovered synthetic companion reply.');
  assert.equal((await api('/api/chat',body)).status,409);
  const invite=await api('/api/admin/invitations',{role:'member'}),other=client();
  await other('/api/auth/invitations/accept',{token:invite.body.token,username:'recoveryother',displayName:'Other synthetic user',password:'synthetic other account password',diaryEnabled:true});
  r=await other(route);assert.equal(r.status,200,r.text);assert.equal(r.body.exchanges.length,0);
  assert.equal((await api('/api/diary/exchanges?day=2026-99-99')).status,400);
  console.log('PASS: real HTTP durable reply/status, duplicate ID 409, day validation and tenant isolation.');
  if(process.env.KEEP_QA==='1'){console.log('Browser fixture: '+origin+' — skillqa / synthetic skill review password');await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
