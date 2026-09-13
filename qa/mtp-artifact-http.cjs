// Explicit integration QA: reads public HF GGUF headers; no inference or private data. KEEP_QA=1 leaves a disposable browser fixture.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const origin='http://localhost:31279',dir=fs.mkdtempSync(path.join(os.tmpdir(),'instruction-skills-http-'));
const requests=[];let readSkill=false;
const upstream=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');
 if(req.url.startsWith('/api/v1/pull/variants'))return res.end(JSON.stringify({suggested_name:'Qwen3.5-9B-GGUF',variants:[{name:'Q4_K_M',files:['Qwen3.5-9B-Q4_K_M.gguf'],primary_file:'Qwen3.5-9B-Q4_K_M.gguf',size_bytes:5680522464}]}));
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
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31279',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31280',MODEL_MANAGER_KIND:'lemonade',MODEL_MANAGER_BASE_URL:'http://127.0.0.1:31280',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 try{
  const api=client();for(let i=0;i<100;i++){try{if((await api('/api/setup/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  let r=await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'skillqa',displayName:'Synthetic Skill QA',password:'synthetic skill review password',diaryEnabled:false});assert.equal(r.status,201,r.text);
  await api('/api/profile/onboarding',{});
  const unauth=await fetch(origin+'/api/models/mtp-artifact?repo=unsloth/Qwen3.5-9B-GGUF&variant=Q4_K_M');assert.equal(unauth.status,401);
  r=await api('/api/models/mtp-artifact?repo=unsloth/Qwen3.5-9B-GGUF&variant=missing');assert.equal(r.status,404);
  r=await api('/api/models/mtp-artifact?repo=unsloth/Qwen3.5-9B-GGUF&variant=Q4_K_M');assert.equal(r.body.status,'absent',r.text);
  r=await api('/api/models/mtp-artifact?repo=unsloth/Qwen3.5-9B-MTP-GGUF&variant=Q4_K_M');assert.equal(r.body.status,'present',r.text);
  console.log('PASS: authenticated HTTP selected-artifact checks, real public GGUF absent/present, missing variant and unauthenticated rejection.');
  if(process.env.KEEP_QA==='1'){console.log('Browser fixture: '+origin+' — skillqa / synthetic skill review password');await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
