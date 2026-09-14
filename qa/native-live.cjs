// Opt-in GPU test. Only use during the guarded native qualification window.
// All app state and MCP writes are synthetic and local. No real Diary endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const {spawn} = require('node:child_process');
const base = process.env.NATIVE_QA_BASE;
if (!base || !process.env.NATIVE_QA_RUN) throw new Error('Explicit NATIVE_QA_BASE and NATIVE_QA_RUN required');
const origin = 'http://localhost:31328', model = 'Qwen_Qwen3.5-4B-GGUF-Q8_0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noevia-native-live-'));
const cookies = new Map(), writes = [];
let server;
const mock = http.createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text || '{}');
  if (!body.id) {res.writeHead(202); return res.end();}
  let result;
  if (body.method === 'initialize') result = {protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'synthetic-memory-only',version:'1'}};
  else if (body.method === 'tools/list') result = {tools:[{name:'nc_notes_create_note',description:'Create one synthetic test note. Call exactly once when requested.',inputSchema:{type:'object',properties:{title:{type:'string'},content:{type:'string'}},required:['title','content']},annotations:{readOnlyHint:false}}]};
  else if (body.method === 'tools/call') {writes.push(body.params);result = {content:[{type:'text',text:'Synthetic note created. Do not create another note.'}]};}
  else throw new Error('Unexpected mock method '+body.method);
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
});
function headers() {return {'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')};}
async function api(url, body, method=body===undefined?'GET':'POST') {
  const res = await fetch(origin+url,{method,headers:headers(),body:body===undefined?undefined:JSON.stringify(body)});
  for(const value of res.headers.getSetCookie()){const p=value.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}
  const text=await res.text();return {status:res.status,text,body:(()=>{try{return JSON.parse(text);}catch{return null;}})()};
}
async function chat(project,chatId,message,decision) {
  const res=await fetch(origin+'/api/chat',{method:'POST',headers:headers(),body:JSON.stringify({spaceId:project.id,projectId:project.id,chatId,message,history:[],effort:'low'}),signal:AbortSignal.timeout(240000)});
  assert.equal(res.status,200);
  const events=[];let buffer='';
  for await(const chunk of res.body){
    buffer+=Buffer.from(chunk).toString('utf8');let pos;
    while((pos=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);
      if(!line.startsWith('data: '))continue;
      let event;try{event=JSON.parse(line.slice(6));}catch{continue;}
      events.push(event);
      if(event.type==='tool_pending'){
        assert.ok(decision,'Unexpected approval: '+JSON.stringify(event));
        assert.equal(event.name,'nc_notes_create_note');
        const args=JSON.parse(event.args);assert.equal(args.title,'Synthetic native QA');assert.equal(args.content,'Fixture 7429');
        const reply=await api('/api/tool-approvals/'+event.id,{decision});assert.equal(reply.status,200,reply.text);
      }
    }
  }
  assert.equal(events.filter(e=>e.type==='error').length,0,JSON.stringify(events));
  assert.ok(events.some(e=>e.type==='done'),JSON.stringify(events));
  return events;
}
(async()=>{
  await new Promise(r=>mock.listen(31329,'127.0.0.1',r));
  const log=fs.openSync(path.join(dir,'server.log'),'w');
  server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore',log,log],env:{...process.env,
    UI_DATA_DIR:dir,UI_HOST:'127.0.0.1',UI_PORT:'31328',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',
    INFERENCE_BASE_URL:base+'/v1',MODEL_MANAGER_BASE_URL:base,MODEL_MANAGER_KIND:'llamacpp',LLAMACPP_PRESET_PATH:'',
    INFERENCE_API_KEY:'',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'',
    EMBEDDING_MODEL:'nomic-embed-text-v1-GGUF',MCP_SERVERS:'nextcloud|http://127.0.0.1:31329|none',MCP_SERVER_URL:'',ENABLED_TOOLBOXES:'core,nextcloud-notes'}});
  fs.closeSync(log);
  for(let i=0;i<100;i++){try{if((await api('/api/setup/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const setup=await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'nativeqa',displayName:'Synthetic Native QA',password:'synthetic native QA password',diaryEnabled:false});assert.equal(setup.status,201,setup.text);
  assert.equal((await api('/api/models/capabilities')).body.kind,'llamacpp');
  const created=await api('/api/projects',{name:'Synthetic native QA',model,toolboxes:['core','nextcloud-notes'],reasoningEffort:'low'});assert.equal(created.status,200,created.text);
  const project=created.body;
  const plain=await chat(project,'native-plain','Reply with exactly APP_NATIVE_OK. Do not use tools.');
  assert.ok(plain.filter(e=>e.type==='delta').map(e=>e.text).join('').includes('APP_NATIVE_OK'),JSON.stringify(plain));
  assert.equal(plain.find(e=>e.type==='context')?.limit,32768,JSON.stringify(plain));
  const message='Call nc_notes_create_note exactly once, with title "Synthetic native QA" and content "Fixture 7429". This is a synthetic in-memory fixture. After the tool result, respond briefly and do not call another tool.';
  for(const [id,decision,expectedWrites,expectedPending] of [
    ['deny','deny',0,1],['once','approve',1,1],['once','deny',1,1],
    ['all','approve_all',2,1],['all',undefined,3,0],['new-chat','deny',3,1],
  ]){
    const events=await chat(project,'native-'+id,message,decision);
    assert.equal(events.filter(e=>e.type==='tool_pending').length,expectedPending,JSON.stringify(events));
    assert.equal(writes.length,expectedWrites,JSON.stringify(writes));
    assert.ok(events.some(e=>e.type==='tool_result'),JSON.stringify(events));
    console.log('PASS native app '+id+' '+(decision||'scoped grant'));
  }
  console.log('PASS actual native app HTTP: cold load/context/stream/tool loop; deny, allow once, chat-scoped grant and separate-chat reapproval; synthetic MCP writes only.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(server){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
  await new Promise(r=>mock.close(r));
  if(process.exitCode)console.error('Synthetic diagnostic directory: '+dir);else fs.rmSync(dir,{recursive:true,force:true});
});
