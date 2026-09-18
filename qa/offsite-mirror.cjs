// D23: off-site backups to a folder that the host mirrors to Google Drive. The Settings page must
// say plainly when the Google half is not connected — so nobody believes they have an off-site
// copy when they only have one on the server — and say so again when it goes stale or fails.
// Real app, folder destination, synthetic account; no Google, no rclone.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const PORT=31383,origin=`http://localhost:${PORT}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-mirror-qa-')),data=path.join(root,'data'),store=path.join(root,'offsite');
 fs.mkdirSync(data);fs.mkdirSync(store);
 const keyFile=path.join(root,'backup.key');fs.writeFileSync(keyFile,crypto.randomBytes(32).toString('hex'),{mode:0o600});
 const report=(o)=>fs.writeFileSync(path.join(store,'.mirror-status.json'),JSON.stringify(o));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:'',
  NOEVIA_FEATURE_OFFSITE_BACKUP:'true',OFFSITE_BACKUP_DIR:store,OFFSITE_BACKUP_MIRROR:'Google Drive',OFFSITE_BACKUP_KEY_FILE:keyFile}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setupCode=fs.readFileSync(path.join(data,'first-run-setup-code'),'utf8').trim();
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const api=(url,body)=>page.evaluate(async({url,body})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};},{url,body});
  await page.goto(origin);
  assert.equal((await api('/api/setup/complete',{setupCode,publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic password QA',diaryEnabled:false})).status,201);
  await api('/api/profile/onboarding',{});
  // The local half works on its own: a real encrypted backup into the folder.
  assert.equal((await api('/api/admin/offsite-backup/run',{})).status,200);
  const open=async(width)=>{
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('dialog',{name:'Settings'});await settings.waitFor();
   if(width<768)await settings.getByLabel('Settings category').selectOption('backups');else await settings.getByRole('button',{name:'Off-site backups',exact:true}).click();
   await settings.getByText('Last restore test').waitFor();
   return settings;
  };
  const close=async(settings)=>{const c=settings.getByRole('button',{name:'Close settings'});await (await c.isVisible()?c:settings.getByRole('button',{name:'Back to app'})).click();};

  // 1. The sync has never run: the page says so rather than implying a copy exists.
  await page.reload(); // leave the setup screen now that the account exists
  let s=await open(1440);
  await s.getByText('Not checked yet · the copy runs nightly at 02:45.').waitFor();
  await close(s);

  // 2. Not connected — the case the user asked for. Loud, and says what to do.
  report({state:'not-connected',at:Date.now(),message:'Google Drive is not connected yet.'});
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width<768?812:900});
   await page.evaluate(t=>localStorage.setItem('cowork-theme',t),theme);await page.reload();
   s=await open(width);
   const row=s.getByText(/^Not connected\. Finish the one-time Google sign-in/);
   await row.waitFor();
   assert.match(await row.innerText(),/backups stay on this server only/);
   assert.ok(await row.evaluate(el=>el.classList.contains('is-error')),'not connected is shown as a problem, not as information');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow at ${width}`);
   if(shots)await page.screenshot({path:`${shots}/offsite-mirror-not-connected-${width}-${theme}.png`});
   await close(s);
  }

  // 3. Connected and recent.
  await page.setViewportSize({width:1440,height:900});
  report({state:'ok',at:Date.now(),message:'Copied 1 snapshots.'});
  s=await open(1440);
  const ok=s.getByText(/^Connected · last copied /);await ok.waitFor();
  assert.equal(await ok.evaluate(el=>el.classList.contains('is-error')),false);
  if(shots)await page.screenshot({path:`${shots}/offsite-mirror-connected-1440-light.png`});
  await close(s);

  // 4. Connected once, but silent for days: not presented as fine.
  report({state:'ok',at:Date.now()-3*86400000,message:'Copied 1 snapshots.'});
  s=await open(1440);
  await s.getByText(/more than two days old/).waitFor();
  await close(s);

  // 5. A failed copy says what happened.
  report({state:'failed',at:Date.now(),message:'The copy to Drive did not finish. See offsite-sync.log on the server.'});
  s=await open(1440);
  await s.getByText(/did not finish/).waitFor();
  await close(s);

  // Nothing about the host's rclone ever reaches the browser.
  const status=(await api('/api/admin/offsite-backup')).body;
  assert.deepEqual(Object.keys(status.mirror).sort(),['at','message','state']);
  assert.deepEqual(errors,[]);
  console.log('PASS offsite mirror: never-run, not connected (375/768/1440 light/dark, shown as a problem), connected, stale after two days, failed; only state, time and message reach the browser.');
 }finally{await browser.close();server.kill('SIGKILL');fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
