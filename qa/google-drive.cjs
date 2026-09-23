// D24: Settings → Backups connects Google Drive with one button. noevia's backend runs Google's
// device sign-in and uploads the encrypted store itself; the page only ever sees a code, the
// account email and the copy's result. Real app, fake Google (qa/fake-google.cjs), synthetic data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {startFakeGoogle}=require('./fake-google.cjs');
const PORT=31383,origin=`http://localhost:${PORT}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const google=await startFakeGoogle();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-gdrive-qa-')),data=path.join(root,'data'),store=path.join(root,'offsite');
 fs.mkdirSync(data);fs.mkdirSync(store);
 const keyHex=crypto.randomBytes(32).toString('hex'),keyFile=path.join(root,'backup.key');fs.writeFileSync(keyFile,keyHex,{mode:0o600});
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:'',
  NOEVIA_FEATURE_OFFSITE_BACKUP:'true',OFFSITE_BACKUP_DIR:store,OFFSITE_BACKUP_KEY_FILE:keyFile,...google.env}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setupCode=fs.readFileSync(path.join(data,'first-run-setup-code'),'utf8').trim();
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const api=(url,body)=>page.evaluate(async({url,body})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};},{url,body});
  await page.goto(origin);
  assert.equal((await api('/api/setup/complete',{setupCode,publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic password QA',diaryEnabled:false})).status,201);
  await api('/api/profile/onboarding',{});
  assert.equal((await api('/api/admin/offsite-backup/run',{})).status,200);
  const open=async(width)=>{
   await page.getByTitle('Settings',{exact:true}).click();
   const settings=page.getByRole('region',{name:'Settings'});await settings.waitFor();
   await settings.getByRole('button',{name:'Backups',exact:true}).click();
   await settings.getByText('Last restore test').waitFor();
   return settings;
  };
  const close=async(s)=>{const c=s.getByRole('button',{name:'Close settings'});await (await c.isVisible()?c:s.getByRole('button',{name:'Back to app'})).click();};

  // 1. Not connected: one button, no commands anywhere, at every width and theme.
  await page.reload();
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width<768?812:900});
   await page.evaluate(t=>localStorage.setItem('cowork-theme',t),theme);await page.reload();
   const s=await open(width);
   const connect=s.getByRole('button',{name:'Connect Google Drive'});await connect.waitFor();
   if(width<768)assert.ok((await connect.boundingBox()).height>=44,'44px target on phones');
   assert.equal(await s.locator('textarea, code').count(),0,'nothing to paste');
   assert.doesNotMatch(await s.innerText(),/ssh |rclone|Terminal/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow at ${width}`);
   await s.getByRole('heading',{name:'Copy to Google Drive'}).scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/gdrive-not-connected-${width}-${theme}.png`});
   await close(s);
  }

  // 2. Connect: the code appears, the page waits, and turns green by itself after approval.
  await page.setViewportSize({width:1440,height:900});
  let s=await open(1440);
  await s.getByRole('button',{name:'Connect Google Drive'}).click();
  const code=s.getByLabel('Google sign-in code');await code.waitFor();
  assert.equal(await code.innerText(),'WDJB-MJHT');
  assert.match(await s.getByRole('link',{name:'Open Google'}).getAttribute('href'),/\/device$/);
  if(shots)await page.screenshot({path:`${shots}/gdrive-pending-1440-light.png`});

  // A failed Cancel must be announced while sign-in stays pending, at each layout and theme.
  await close(s);
  let failedCancels=0;
  await page.route('**/api/admin/offsite-backup/google/disconnect',route=>{
   failedCancels++;
   return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic Cancel failure'})});
  });
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width<768?812:900});
   await page.evaluate(t=>localStorage.setItem('cowork-theme',t),theme);await page.reload();
   s=await open(width);
   await s.getByLabel('Google sign-in code').waitFor();
   const cancel=s.getByRole('button',{name:'Cancel'});
   await cancel.focus();
   assert.ok(await cancel.evaluate(el=>document.activeElement===el),'Cancel can receive keyboard focus');
   await page.keyboard.press('Enter');
   await s.locator('.gdrive-pending').getByRole('alert').getByText('Synthetic Cancel failure').waitFor();
   await page.waitForFunction(()=>!document.querySelector('.gdrive-pending .gdrive-actions button')?.disabled);
   assert.equal(await s.locator('.gdrive-pending').getByRole('alert').count(),1);
   assert.ok(await cancel.isEnabled(),'Cancel can be retried');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow after failure at ${width}`);
   await close(s);
  }
  assert.equal(failedCancels,6);
  await page.unroute('**/api/admin/offsite-backup/google/disconnect');
  s=await open(1440);
  await s.getByRole('button',{name:'Cancel'}).click();
  await s.getByRole('button',{name:'Connect Google Drive'}).waitFor();
  assert.equal(await s.getByRole('alert').count(),0,'successful retry clears the error');
  await s.getByRole('button',{name:'Connect Google Drive'}).click();
  await s.getByLabel('Google sign-in code').waitFor();
  google.approve();
  await s.getByText(/^Connected · /).waitFor({timeout:20000});
  await s.getByText('backup-owner@example.com').waitFor();
  await s.getByText(/^Connected · last copied /).waitFor({timeout:20000});
  const onDrive=[...google.files.values()].filter(f=>f.name!=='noevia-offsite').map(f=>f.name).sort();
  assert.deepEqual(onDrive,fs.readdirSync(store,{recursive:true}).filter(n=>!fs.statSync(path.join(store,n)).isDirectory()&&!path.basename(n).startsWith('.')).map(n=>n.split(path.sep).join('/')).sort(),'every encrypted object is on Drive');
  if(shots)await page.screenshot({path:`${shots}/gdrive-connected-1440-light.png`});

  // 3. Recovery key downloads as a file holding the key.
  const [download]=await Promise.all([page.waitForEvent('download'),s.getByRole('link',{name:'Download recovery key'}).click()]);
  assert.match(fs.readFileSync(await download.path(),'utf8'),new RegExp(keyHex));

  // 4. Nothing secret reaches the browser.
  const status=JSON.stringify((await api('/api/admin/offsite-backup')).body);
  for(const t of [...google.state.refresh,...google.state.access])assert.equal(status.includes(t),false,'no Google token in the page');

  // 5. Disconnect revokes at Google and offers Connect again.
  await s.getByRole('button',{name:'Disconnect'}).click();
  await s.getByRole('button',{name:'Connect Google Drive'}).waitFor();
  assert.equal(google.state.revoked.length,1);
  await close(s);
  assert.deepEqual(errors,[]);
  console.log('PASS google drive: one-button connect with no commands (375/768/1440 light/dark), code shown, turns green by itself after approval, every encrypted object copied, recovery key download, no token in the page, failed Cancel alert and successful retry at 375/768/1440 light/dark, disconnect revokes.');
 }finally{await browser.close();server.kill('SIGKILL');await google.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
