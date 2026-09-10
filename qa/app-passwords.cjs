// Real disposable app, synthetic accounts only; no diary service or corpus.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31248',web=path.resolve(__dirname,'..');
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};
 },{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-passwords-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31248',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const admin=await browser.newPage();await admin.goto(origin);
  assert.equal((await api(admin,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic password QA',diaryEnabled:false})).status,201);
  await api(admin,'/api/profile/onboarding',{});
  const invitation=await api(admin,'/api/admin/invitations',{role:'member'});
  const member=await browser.newPage();await member.goto(origin);
  assert.equal((await api(member,'/api/auth/invitations/accept',{token:invitation.body.token,username:'memberqa',displayName:'Synthetic member',password:'synthetic password QA',diaryEnabled:false})).status,201);
  await api(member,'/api/profile/onboarding',{});
  const minted=await api(member,'/api/profile/app-passwords',{name:'Member phone',scope:'lan'});
  assert.equal(minted.status,201);assert.equal(minted.cache,'no-store');
  assert.deepEqual((await api(admin,'/api/profile/app-passwords')).body.appPasswords,[]);
  assert.equal((await api(admin,'/api/profile/app-passwords/'+minted.body.id,undefined,'DELETE')).status,404);
  assert.equal((await member.evaluate(async()=>{const r=await fetch('/api/profile/app-passwords',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'bad',scope:'lan'})});return r.status;})),403);
  for(const authorization of ['Bearer '+minted.body.password,'Basic '+Buffer.from('memberqa:'+minted.body.password).toString('base64')]){
   for(const route of ['/api/workspace','/api/profile/app-passwords','/api/chat']) assert.equal((await fetch(origin+route,{method:route==='/api/chat'?'POST':'GET',headers:{authorization,origin}})).status,401);
  }
  assert.equal((await api(member,'/api/auth/login/password',{username:'memberqa',password:minted.body.password})).status,401);
  await member.reload();
  await member.getByRole('button',{name:/Account menu for/}).click();await member.getByRole('button',{name:'Settings',exact:true}).click();
  await member.getByRole('button',{name:'Profile & security',exact:true}).click();
  await member.getByRole('region',{name:'App passwords'}).waitFor();
  await member.getByLabel('Device name',{exact:true}).fill('Synthetic laptop');
  await member.getByLabel('Credential scope',{exact:true}).selectOption('public');
  await member.getByRole('button',{name:'Generate app password',exact:true}).click();
  const input=member.getByLabel('New app password',{exact:true});await input.waitFor();
  const secret=await input.inputValue(); assert.match(secret,/^nv_dav_/);
  assert.equal((await api(member,'/api/profile/app-passwords')).body.appPasswords.some(p=>p.password),false);
  for(const theme of ['light','dark'])for(const width of [375,768,1440]){
   await member.setViewportSize({width,height:1000});await member.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.equal(await member.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await input.scrollIntoViewIfNeeded(); await input.focus();
   if(process.env.QA_SCREENSHOTS)await member.screenshot({path:`${process.env.QA_SCREENSHOTS}/passwords-${theme}-${width}.png`,fullPage:true,animations:'disabled'});
  }
  await member.getByRole('button',{name:'Dismiss password'}).click(); assert.equal(await input.count(),0);
  await member.getByRole('button',{name:'Revoke Synthetic laptop',exact:true}).click();
  await member.getByRole('button',{name:'Revoke Synthetic laptop',exact:true}).waitFor({state:'detached'});
  await member.reload();await member.getByRole('button',{name:/Account menu for/}).click();await member.getByRole('button',{name:'Settings',exact:true}).click();await member.getByRole('button',{name:'Profile & security',exact:true}).click();
  assert.equal(await member.getByLabel('New app password',{exact:true}).count(),0);
  assert.equal((await api(member,'/api/profile/app-passwords')).body.appPasswords.length,1);
  console.log('PASS app-password lifecycle, CSRF, tenant isolation, app auth refusal and responsive UI');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit').catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
