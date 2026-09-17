// D7: real app + a local fake S3 endpoint (never a real provider). Backup, retention and restore
// test through the admin API and the Settings page; the fake store must never see plaintext.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const PORT=31381,S3=31382,origin=`http://localhost:${PORT}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'';
function fakeS3(objects){
 return http.createServer(async(req,res)=>{
  if(!/^AWS4-HMAC-SHA256 Credential=QAKEY\//.test(req.headers.authorization||'')){res.writeHead(403);return res.end();}
  const u=new URL(req.url,'http://x');
  if(u.searchParams.get('list-type')==='2'){const p=u.searchParams.get('prefix');res.writeHead(200);return res.end(`<ListBucketResult>${[...objects.keys()].filter(k=>k.startsWith(p)).map(k=>`<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);}
  const key=decodeURIComponent(u.pathname).replace(/^\/qa-bucket\//,'');
  if(req.method==='PUT'){const c=[];for await(const x of req)c.push(x);objects.set(key,Buffer.concat(c));res.writeHead(200);return res.end();}
  if(req.method==='GET'){if(!objects.has(key)){res.writeHead(404);return res.end();}res.writeHead(200);return res.end(objects.get(key));}
  if(req.method==='DELETE'){objects.delete(key);res.writeHead(204);return res.end();}
  res.writeHead(405);res.end();
 });
}
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-offsite-qa-')),data=path.join(root,'data');fs.mkdirSync(data);
 const keyFile=path.join(root,'backup.key');fs.writeFileSync(keyFile,crypto.randomBytes(32).toString('hex'),{mode:0o600});
 const objects=new Map(),s3=fakeS3(objects);await new Promise(r=>s3.listen(S3,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:'',
  NOEVIA_FEATURE_OFFSITE_BACKUP:'true',OFFSITE_BACKUP_S3_ENDPOINT:`http://127.0.0.1:${S3}`,OFFSITE_BACKUP_S3_BUCKET:'qa-bucket',OFFSITE_BACKUP_S3_ACCESS_KEY_ID:'QAKEY',OFFSITE_BACKUP_S3_SECRET_ACCESS_KEY:'QA-SECRET-VALUE',OFFSITE_BACKUP_KEY_FILE:keyFile}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setupCode=fs.readFileSync(path.join(data,'first-run-setup-code'),'utf8').trim();
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const api=(url,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({url,body,method})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};},{url,body,method});
  await page.goto(origin);
  assert.equal((await api('/api/setup/complete',{setupCode,publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic password QA',diaryEnabled:false})).status,201);
  await api('/api/profile/onboarding',{});
  await api('/api/projects',{name:'Backup marker project',files:[{name:'marker.md',content:'OFFSITE-PLAINTEXT-MARKER'}]});
  const run=await api('/api/admin/offsite-backup/run',{});
  assert.equal(run.status,200,JSON.stringify(run.body));
  assert.ok(run.body.files>=3,'auth db, projects and marker captured');
  for(const [k,v] of objects){assert.ok(!v.includes('OFFSITE-PLAINTEXT-MARKER'),`plaintext in ${k}`);assert.ok(!k.includes('marker')&&!k.includes('projects'),`name leaked in ${k}`);}
  const verify=await api('/api/admin/offsite-backup/verify',{});
  assert.equal(verify.status,200,JSON.stringify(verify.body));
  const status=(await api('/api/admin/offsite-backup')).body;
  assert.equal(status.snapshots,1);assert.ok(!JSON.stringify(status).includes('QA-SECRET-VALUE'));
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width<768?812:900});
   await page.evaluate(t=>localStorage.setItem('cowork-theme',t),theme);await page.reload();
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('dialog',{name:'Settings'});await settings.waitFor();
   if(width<768)await settings.getByLabel('Settings category').selectOption('backups');else await settings.getByRole('button',{name:'Off-site backups',exact:true}).click();
   await settings.getByText('Last restore test').waitFor();
   await settings.getByText(/files verified/).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   if(shots)await page.screenshot({path:`${shots}/offsite-${width}-${theme}.png`});
   if(width===1440&&theme==='light'){await settings.getByRole('button',{name:'Back up now'}).click();await settings.getByRole('button',{name:'Back up now'}).waitFor();}
   {const close=settings.getByRole('button',{name:'Close settings'});await (await close.isVisible()?close:settings.getByRole('button',{name:'Back to app'})).click();} // phones hide the detail bar (0d269fa)
  }
  assert.deepEqual(errors,[]);
  console.log('PASS offsite backup: real app, fake S3, encrypted objects without plaintext or names, run + retention + restore test, admin settings page 375/768/1440 light/dark.');
 }finally{await browser.close();server.kill('SIGKILL');s3.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
