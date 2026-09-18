// The setup wizard offers Google Drive backups to an administrator: one Connect button, the code
// Google asks for, and a green confirmation once approved. Skipping is always possible.
// Real app, fake Google (qa/fake-google.cjs), synthetic account.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {startFakeGoogle}=require('./fake-google.cjs');
const PORT=31384,origin=`http://localhost:${PORT}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'';
(async()=>{
 const google=await startFakeGoogle();
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-wizard-backup-qa-')),data=path.join(root,'data'),store=path.join(root,'offsite');
 fs.mkdirSync(data);fs.mkdirSync(store);
 const keyFile=path.join(root,'backup.key');fs.writeFileSync(keyFile,crypto.randomBytes(32).toString('hex'),{mode:0o600});
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:'',
  NOEVIA_FEATURE_OFFSITE_BACKUP:'true',OFFSITE_BACKUP_DIR:store,OFFSITE_BACKUP_KEY_FILE:keyFile,...google.env}});
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

  // Not connected: one button, nothing to paste; skipping works.
  for(const width of [375,768,1440])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:width<768?812:900});
   await page.evaluate(t=>localStorage.setItem('cowork-theme',t),theme);
   await toBackupStep();
   const connect=page.getByRole('button',{name:'Connect Google Drive'});
   assert.ok((await connect.boundingBox()).height>=44,'44px target');
   assert.equal(await page.locator('textarea').count(),0,'nothing to paste');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow at ${width}`);
   if(shots)await page.screenshot({path:`${shots}/wizard-backup-${width}-${theme}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Preferences'}).waitFor();

  // Connect from the wizard: code, approval, and the step confirms by itself.
  await page.setViewportSize({width:1440,height:900});
  await toBackupStep();
  await page.getByRole('button',{name:'Connect Google Drive'}).click();
  await page.getByLabel('Google sign-in code').waitFor();
  if(shots)await page.screenshot({path:`${shots}/wizard-backup-pending-1440.png`,fullPage:true});
  google.approve();
  await page.getByText('Google Drive is connected as backup-owner@example.com.').waitFor({timeout:20000});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('heading',{name:'Preferences'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS wizard backup: admin sees a one-button Google Drive step (375/768/1440 light/dark), nothing to paste, skip works, connecting shows the code and confirms by itself after approval.');
 }finally{await browser.close();server.kill('SIGKILL');await google.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
