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
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-connector-')),data=new Map();let puts=0;
 const hash=t=>require('node:crypto').createHash('sha256').update(t).digest('hex');
 const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{},owner=req.headers['x-cowork-user-id'];
  assert.ok(owner);const value=data.get(owner)??'Synthetic original';res.setHeader('Content-Type','application/json');
  if(req.url.startsWith('/api/files'))return res.end(JSON.stringify({files:[{path:'entry.md',name:'entry.md',isDir:false}]}));
  if(req.url==='/api/file'&&req.method==='PUT'){puts++;if(body.version!==hash(value)){res.statusCode=409;return res.end(JSON.stringify({detail:'Changed elsewhere'}));}data.set(owner,body.content);}
  const content=data.get(owner)??value;res.end(JSON.stringify({path:'entry.md',content,version:hash(content)}));
 });await new Promise(r=>upstream.listen(31260,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31259',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1/v1',DIARY_BASE_URL:'http://127.0.0.1:31260',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const page=await browser.newPage();await page.goto(origin);
  assert.equal((await api(page,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic connector password',diaryEnabled:true})).status,201);
  const minted=await api(page,'/api/profile/diary-connectors',{name:'Synthetic Claude'});assert.equal(minted.status,201);
  const send=async(body,token=minted.body.token,headers={})=>{const r=await fetch(origin+'/api/diary-connector',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await send({action:'read',path:'entry.md'},'bad')).status,401);
  assert.equal((await send({action:'read',path:'entry.md'},minted.body.token,{Origin:'https://evil.invalid'})).status,403);
  const first=await send({action:'read',path:'entry.md'});assert.equal(first.status,200);assert.equal(first.body.content,'Synthetic original');
  const changed=await send({action:'write',path:'entry.md',version:first.body.version,content:'Synthetic new'});assert.equal(changed.status,200);
  assert.equal((await send({action:'read',path:'entry.md'})).body.content,'Synthetic new');
  assert.equal((await send({action:'write',path:'entry.md',version:first.body.version,content:'stale'})).status,409);assert.equal(puts,2);
  assert.equal((await send({action:'write',path:'../outside.md',version:null,content:'bad'})).status,400);assert.equal(puts,2);
  assert.equal((await api(page,'/api/profile/diary-connectors/'+minted.body.id,undefined,'DELETE')).status,200);
  assert.equal((await send({action:'read',path:'entry.md'})).status,401);
  console.log('PASS real connector authentication, browser-origin refusal, live reads/versioned writes, stale conflict, path scope and revocation');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
