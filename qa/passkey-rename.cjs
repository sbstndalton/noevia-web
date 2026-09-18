// A passkey made before a web address change must not block adding or using passkeys at the new
// address (the live bug: "The RP ID cowork.daserver.work is invalid for this domain").
// Real app, Chrome's virtual authenticator, two loopback names: old.localhost → new.localhost.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const PORT=31385,OLD=`http://old.localhost:${PORT}`,NEW=`http://new.localhost:${PORT}`,web=path.resolve(__dirname,'..');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-passkey-qa-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:OLD,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome',args:['--host-resolver-rules=MAP *.localhost 127.0.0.1']});
 try{
  for(let i=0;i<200;i++){try{if((await fetch(`http://127.0.0.1:${PORT}/api/setup/status`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setupCode=fs.readFileSync(path.join(data,'first-run-setup-code'),'utf8').trim();
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  const cdp=await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  const api=(url,body)=>page.evaluate(async({url,body})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};},{url,body});
  const addPasskeyInSettings=async()=>{
   await page.getByTitle('Settings',{exact:true}).click();
   const s=page.getByRole('dialog',{name:'Settings'});await s.waitFor();
   await s.getByRole('button',{name:'Security',exact:true}).click();
   await s.getByRole('button',{name:'+ Add passkey'}).click();
   await s.getByText('Passkey added.').waitFor({timeout:15000});
   await s.getByRole('button',{name:'Close settings'}).click();
  };

  // 1. Account and a passkey at the old address.
  await page.goto(OLD);
  assert.equal((await api('/api/setup/complete',{setupCode,publicOrigin:OLD,username:'pkqa',displayName:'Passkey QA',password:'synthetic password QA',diaryEnabled:false})).status,201);
  await api('/api/profile/onboarding',{});
  await page.reload();
  await addPasskeyInSettings();

  // 2. Rename the site (as Settings → Web address does), then sign in again at the new address.
  assert.equal((await api('/api/admin/web-address',{origin:NEW,force:true})).status,200);
  await page.goto(NEW);
  await page.getByLabel('Username').fill('pkqa');await page.getByLabel('Password').fill('synthetic password QA');
  await page.getByRole('button',{name:'Sign in with password'}).click();
  // 3. The live bug: noevia offers to create a passkey here; it must work, made for the new name.
  const secure=page.getByRole('button',{name:'Create a passkey'});
  await Promise.race([secure.waitFor(),page.getByTitle('Settings',{exact:true}).waitFor()]);
  assert.ok(await secure.isVisible(),'noevia offers a passkey for the new address');
  const made=page.waitForResponse(r=>r.url().endsWith('/api/auth/passkeys/register/verify'));
  await secure.click();
  assert.equal((await made).status(),200,'the passkey is made for the new address');
  await secure.waitFor({state:'detached'});

  // 4. Sign out and sign in with the passkey at the new address.
  await page.context().clearCookies();
  await page.goto(NEW);
  await page.getByLabel('Username').fill('pkqa');
  await page.getByRole('button',{name:'Use a passkey (recommended)'}).click();
  await page.getByTitle('Settings',{exact:true}).waitFor({timeout:15000});
  console.log('PASS passkey rename: passkey made at the old address; after the address change a new passkey is added at the new address and signs in there.');
 }finally{await browser.close();server.kill('SIGKILL');fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
