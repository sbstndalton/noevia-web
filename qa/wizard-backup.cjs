// The setup wizard offers Google Drive backups to an administrator when the server has a folder
// destination that the host mirrors. Steps are copyable commands; skipping is always possible;
// once connected the step just confirms it. Real app, synthetic account; no Google, no rclone.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const PORT=31384,origin=`http://localhost:${PORT}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-wizard-backup-qa-')),data=path.join(root,'data'),store=path.join(root,'offsite');
 fs.mkdirSync(data);fs.mkdirSync(store);
 const keyFile=path.join(root,'backup.key');fs.writeFileSync(keyFile,crypto.randomBytes(32).toString('hex'),{mode:0o600});
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:'',
  NOEVIA_FEATURE_OFFSITE_BACKUP:'true',OFFSITE_BACKUP_DIR:store,OFFSITE_BACKUP_MIRROR:'Google Drive',OFFSITE_BACKUP_KEY_FILE:keyFile}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setupCode=fs.readFileSync(path.join(data,'first-run-setup-code'),'utf8').trim();
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const api=(url,body)=>page.evaluate(async({url,body})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return r.status;},{url,body});
  await page.goto(origin);
  assert.equal(await api('/api/setup/complete',{setupCode,publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic password QA',diaryEnabled:false}),201);
  const toBackupStep=async()=>{
   await page.reload();
   await page.getByRole('heading',{name:'Connect an inference provider'}).waitFor();
   await page.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
   await page.getByRole('heading',{name:'Set up the diary'}).waitFor();
   await page.getByRole('button',{name:'Continue',exact:true}).click();
   await page.getByRole('heading',{name:'Back up to Google Drive'}).waitFor();
  };

  // Not connected: both commands are there, targets are big enough, and it can be skipped.
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width<768?812:900});
   await page.evaluate(t=>localStorage.setItem('cowork-theme',t),theme);
   await toBackupStep();
   assert.match(await page.getByLabel('Command to show the backup key').inputValue(),/^ssh root@localhost cat /,'falls back to root@ the page host');
   assert.match(await page.getByLabel('Command to connect Google Drive').inputValue(),/rclone authorize "drive"/);
   for(const b of await page.locator('.gdrive-setup button').all())assert.ok((await b.boundingBox()).height>=44,'44px targets');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow at ${width}`);
   if(shots)await page.screenshot({path:`${shots}/wizard-backup-${width}-${theme}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Preferences'}).waitFor();

  // "Check connection" picks up the host's report without leaving the step.
  await toBackupStep();
  fs.writeFileSync(path.join(store,'.mirror-status.json'),JSON.stringify({state:'ok',at:Date.now(),message:'Copied 1 snapshots.'}));
  await page.getByRole('button',{name:'Check connection'}).click();
  await page.getByText('Google Drive is connected.').waitFor();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('heading',{name:'Preferences'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS wizard backup: admin sees the Google Drive step (375/768/1440 light/dark), copyable key and sign-in commands, skip works, Check connection confirms once the host reports ok.');
 }finally{await browser.close();server.kill('SIGKILL');fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
