// Real web app + dedicated listener, synthetic companion API and tenants only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31249',dav='http://localhost:31250',web=path.resolve(__dirname,'..');
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};
 },{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-dav-')),data={},seen=[];
 const companion=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');const id=req.headers['x-cowork-user-id'];
  if(req.headers.authorization!=='Bearer synthetic-only'||!id){res.statusCode=401;return res.end('{}');}
  seen.push(id);data[id]??={'entry.md':'Synthetic '+id};let body='';for await(const c of req)body+=c;
  if(req.url.startsWith('/api/files'))return res.end(JSON.stringify({files:Object.keys(data[id]).map(path=>({path,name:path,isDir:false}))}));
  if(req.url==='/api/file'){
   const b=JSON.parse(body),current=data[id][b.path]??null;
   if(req.method==='PUT'){
    if((current===null?null:digest(current))!==b.version){res.statusCode=409;return res.end(JSON.stringify({detail:'Conflict'}));}
    data[id][b.path]=b.content;
   }
   const content=data[id][b.path]??null;return res.end(JSON.stringify({content,version:content===null?null:digest(content)}));
  }
  res.end('{}');
 });await new Promise(r=>companion.listen(31251,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31249',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:31251',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:'',COWORK_DAV_PORT:'31250',COWORK_DAV_SCOPE:'lan',COWORK_DAV_ORIGIN:dav}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const admin=await browser.newPage();await admin.goto(origin);
  const setup=await api(admin,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic password QA',diaryEnabled:true});assert.equal(setup.status,201);const id=setup.body.user.id;
  await api(admin,'/api/profile/onboarding',{});
  const credential=(await api(admin,'/api/profile/app-passwords',{name:'Test laptop',scope:'lan'})).body;
  const headers={Authorization:'Basic '+Buffer.from('adminqa:'+credential.password).toString('base64')};
  assert.equal((await fetch(dav+'/dav/adminqa/entry.md',{headers})).status,403);
  assert.equal((await api(admin,'/api/profile/sharing',{scope:'lan'},'PUT')).status,400);
  await admin.reload();await admin.getByRole('button',{name:/Account menu for/}).click();await admin.getByRole('button',{name:'Settings',exact:true}).click();await admin.getByRole('button',{name:'Diary & storage',exact:true}).click();
  await admin.getByLabel('Diary sharing access').selectOption('lan');assert.equal(await admin.getByRole('button',{name:'Save sharing',exact:true}).isDisabled(),true);
  await admin.getByRole('checkbox',{name:/I understand plain HTTP/}).check();await admin.getByRole('button',{name:'Save sharing',exact:true}).click();
  await admin.getByLabel('Diary sharing URL').waitFor();assert.equal(await admin.getByLabel('Diary sharing URL').inputValue(),dav+'/dav/adminqa/');
  for(const theme of ['light','dark'])for(const width of [375,768,1440]){
   await admin.setViewportSize({width,height:1000});await admin.evaluate(t=>document.documentElement.dataset.theme=t,theme);await admin.getByLabel('Diary sharing URL').scrollIntoViewIfNeeded();
   assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.QA_SCREENSHOTS)await admin.screenshot({path:`${process.env.QA_SCREENSHOTS}/dav-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
  }
  let r=await fetch(dav+'/dav/adminqa/entry.md',{headers});assert.equal(r.status,200);assert.equal(await r.text(),'Synthetic '+id);const tag=r.headers.get('etag');
  r=await fetch(dav+'/dav/adminqa/entry.md',{method:'PUT',headers:{...headers,'If-Match':tag},body:'Synthetic updated file'});assert.equal(r.status,204);assert.equal(data[id]['entry.md'],'Synthetic updated file');
  assert.equal((await fetch(dav+'/dav/adminqa/entry.md',{method:'PUT',headers:{...headers,'If-Match':tag},body:'stale'})).status,412);
  assert.equal((await fetch(dav+'/dav/other/entry.md',{headers})).status,401);
  assert.equal((await fetch(origin+'/api/diary/files',{headers})).status,401);
  assert.ok(seen.every(userId=>userId===id));
  await api(admin,'/api/profile/app-passwords/'+credential.id,undefined,'DELETE');assert.equal((await fetch(dav+'/dav/adminqa/entry.md',{headers})).status,401);
  await api(admin,'/api/profile/sharing',{scope:'off'},'PUT');assert.equal((await api(admin,'/api/profile/sharing')).body.scope,'off');
  console.log('PASS dedicated DAV listener, real credentials, opt-in UI, tenant forwarding, conditional writes, revocation and responsive UI');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit').catch(()=>{});await new Promise(r=>companion.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
