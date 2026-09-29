// #555 native-app sign-in: the /device approval screen and Settings → Security and login's
// signed-in apps list, in a real browser against a disposable server with the nativeClientAuth
// feature on. Synthetic accounts only; no Diary service, corpus or model is reached.
//
//   PLAYWRIGHT_MODULE=…/playwright-core QA_SCREENSHOTS=<dir> node qa/device-approval-555.cjs
//   QA_WEB=<another apps/web checkout> runs the same script against that build (e.g. origin/main,
//   where it must fail: there is no device endpoint and no /device page).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31255',web=process.env.QA_WEB?path.resolve(process.env.QA_WEB):path.resolve(__dirname,'..');
const DEVICE_GRANT='urn:ietf:params:oauth:grant-type:device_code';
const PASSWORD='synthetic password QA';
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};
 },{url,body,method});
}
// The native app's side, from Node: no cookies, no Origin, like NoeviaKit.
async function native(url,body,token){
 const r=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,body:await r.json().catch(()=>null)};
}
async function shots(page,name){
 for(const theme of ['light','dark'])for(const width of [375,768,1440]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflows at ${width} ${theme}`);
  if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/device-${name}-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
 }
 await page.setViewportSize({width:1280,height:900});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-device-qa-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31255',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',NOEVIA_FEATURE_NATIVE_CLIENT_AUTH:'true',TRUST_PROXY:'true',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const admin=await browser.newPage();await admin.goto(origin);
  assert.equal((await api(admin,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:PASSWORD,diaryEnabled:false})).status,201);
  await api(admin,'/api/profile/onboarding',{});

  // 1. The app starts a sign-in; the person opens the link it shows, already signed in.
  const flow=await native('/api/auth/device/code',{client_name:'Synthetic Mac'});
  assert.equal(flow.status,200,'POST /api/auth/device/code must exist');
  assert.equal((await native('/api/auth/device/token',{grant_type:DEVICE_GRANT,device_code:flow.body.device_code})).body.error,'authorization_pending');
  await admin.goto(flow.body.verification_uri_complete);
  await admin.getByRole('heading',{name:'Sign in an app'}).waitFor();
  assert.equal(await admin.getByLabel('Code',{exact:true}).inputValue(),flow.body.user_code,'the link fills in the code');
  await shots(admin,'enter');
  await admin.getByRole('button',{name:'Continue',exact:true}).click();
  // 2. The confirmation screen shows the app's name and the code to compare, and nothing is
  //    approved until the person clicks.
  const title=admin.getByRole('heading',{name:'Sign in Synthetic Mac?'});await title.waitFor();
  assert.equal(await title.evaluate(el=>el===document.activeElement),true,'focus moves to the question');
  assert.equal((await admin.locator('.device-code').textContent()).trim(),flow.body.user_code);
  await admin.getByText(/Only approve if you started this sign-in yourself/).waitFor();
  // Shared browsers: the page says which account the app will be signed in to.
  await admin.getByText('Approving signs the app in to your account: Synthetic admin (adminqa).').waitFor();
  // The feature needs TRUST_PROXY (review N3), so the requester's address is real and shown.
  await admin.getByText(/^Requested from 127\.0\.0\.1 at /).waitFor();
  assert.equal((await native('/api/auth/device/token',{grant_type:DEVICE_GRANT,device_code:flow.body.device_code})).status,400,'still pending on the confirmation screen');
  await shots(admin,'confirm');
  await admin.getByRole('button',{name:'Approve Synthetic Mac',exact:true}).click();
  await admin.getByRole('heading',{name:'App signed in'}).waitFor();
  await shots(admin,'approved');

  // 3. The app receives its tokens and uses the API as the same account.
  await new Promise(r=>setTimeout(r,5100)); // respect the poll interval
  const tokens=await native('/api/auth/device/token',{grant_type:DEVICE_GRANT,device_code:flow.body.device_code});
  assert.equal(tokens.status,200);
  assert.equal((await native('/api/workspace',undefined,tokens.body.access_token)).status,200);
  assert.equal((await native('/api/admin/users',undefined,tokens.body.access_token)).status,403,'never administration');
  const linked=await fetch(origin+'/api/connectors/gdrive/policy',{method:'PUT',headers:{'Content-Type':'application/json',authorization:`Bearer ${tokens.body.access_token}`},body:JSON.stringify({tools:[],mode:'allow'})});
  assert.equal(linked.status,403,'never connector policy');

  // 4. Settings → Security and login lists the app with its last-used time; Revoke signs it out.
  await admin.goto(origin);
  await admin.getByRole('button',{name:/Account menu for/}).click();await admin.locator('.account-popover').getByRole('menuitem',{name:'Settings',exact:true}).click();
  await admin.getByRole('button',{name:'Security and login',exact:true}).click();
  const list=admin.getByRole('region',{name:'Signed-in apps'});await list.waitFor();
  await list.getByText('Synthetic Mac',{exact:true}).waitFor();
  await list.getByText(/last used/).waitFor();
  await shots(admin,'settings');
  await list.getByRole('button',{name:'Revoke Synthetic Mac',exact:true}).click();
  await list.getByText('Synthetic Mac was signed out.').waitFor();
  assert.equal(await list.getByRole('button',{name:'Revoke Synthetic Mac',exact:true}).count(),0);
  await list.getByText('No apps are signed in.').waitFor();
  assert.equal((await native('/api/workspace',undefined,tokens.body.access_token)).status,401,'revocation is immediate');
  assert.equal((await native('/api/auth/device/token',{grant_type:'refresh_token',refresh_token:tokens.body.refresh_token})).body.error,'invalid_grant');

  // 5. Signed out: the link leads through sign-in to the same screen, and Deny yields no token.
  const second=await native('/api/auth/device/code',{client_name:'Unknown laptop'});
  const guest=await (await browser.newContext()).newPage();
  await guest.goto(second.body.verification_uri_complete);
  await guest.getByLabel('Username').fill('adminqa');await guest.getByLabel('Password').fill(PASSWORD);
  await guest.getByRole('button',{name:'Sign in with password'}).click();
  await guest.getByRole('button',{name:'Set up later'}).click();
  await guest.getByRole('heading',{name:'Sign in an app'}).waitFor();
  await guest.getByRole('button',{name:'Continue',exact:true}).click();
  await guest.getByRole('heading',{name:'Sign in Unknown laptop?'}).waitFor();
  // "Not you? Sign out" signs this browser out and comes back to the same code.
  await guest.getByRole('button',{name:'Not you? Sign out',exact:true}).click();
  await guest.getByLabel('Password').waitFor();
  assert.match(guest.url(),new RegExp(`/device\\?code=${second.body.user_code}$`));
  await guest.getByLabel('Username').fill('adminqa');await guest.getByLabel('Password').fill(PASSWORD);
  await guest.getByRole('button',{name:'Sign in with password'}).click();
  await guest.getByRole('button',{name:'Set up later'}).click();
  await guest.getByRole('button',{name:'Continue',exact:true}).click();
  await guest.getByRole('heading',{name:'Sign in Unknown laptop?'}).waitFor();
  await guest.getByRole('button',{name:'Deny',exact:true}).click();
  await guest.getByRole('heading',{name:'Sign-in denied'}).waitFor();
  assert.equal((await native('/api/auth/device/token',{grant_type:DEVICE_GRANT,device_code:second.body.device_code})).body.error,'access_denied');

  // 6. A wrong code says so, without leaving the entry step.
  await guest.goto(origin+'/device');
  await guest.getByLabel('Code',{exact:true}).fill('bcdf ghjk');
  assert.equal(await guest.getByLabel('Code',{exact:true}).inputValue(),'BCDF-GHJK');
  await guest.getByRole('button',{name:'Continue',exact:true}).click();
  await guest.getByRole('alert').filter({hasText:'That code is not valid or has expired.'}).waitFor();
  console.log('PASS device approval screen, deny path, signed-in apps list with last-used time and immediate revoke');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit').catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
