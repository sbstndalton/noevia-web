// #733 Connect a device. Real disposable app with a LAN file-sharing endpoint, synthetic account only; no Diary
// service or corpus. Fails on main (no "Connect a device" button), passes on the branch.
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/connect-device.cjs   (after `npm run build`)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31251',davOrigin='http://localhost:31252',web=path.resolve(__dirname,'..');
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};
 },{url,body,method});
}
(async()=>{
 const dir=(fs.mkdirSync(path.join(web,'.qa-tmp'),{recursive:true}),fs.mkdtempSync(path.join(web,'.qa-tmp','connect-')));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:process.env.QA_VERBOSE?'inherit':'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31251',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,COWORK_DAV_PORT:'31252',COWORK_DAV_SCOPE:'lan',COWORK_DAV_ORIGIN:davOrigin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const ctx=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  const page=await ctx.newPage();page.setDefaultTimeout(5000);await page.goto(origin);
  assert.equal((await api(page,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'deviceqa',displayName:'Synthetic user',password:'synthetic password QA',diaryEnabled:true})).status,201);
  await api(page,'/api/profile/onboarding',{});
  assert.equal((await api(page,'/api/profile/sharing')).body.scope,'off','sharing starts off');
  await page.reload();
  const openSettings=async()=>{await page.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('menuitem',{name:'Settings',exact:true}).click();};
  await openSettings();
  await page.getByRole('button',{name:'Diary & storage',exact:true}).click();
  await page.getByRole('button',{name:'Connect a device',exact:true}).click();
  const panel=page.getByRole('region',{name:'Connect a device'});await panel.waitFor();
  const submit=panel.getByRole('button',{name:'Connect device',exact:true});
  assert.equal(await submit.isDisabled(),true,'needs a device name');
  await panel.getByLabel('Device name',{exact:true}).fill('Synthetic laptop');
  assert.equal(await submit.isDisabled(),true,'plain HTTP needs the acknowledgement');
  await panel.getByRole('checkbox').check();
  await submit.click();
  const pw=panel.getByLabel('App password',{exact:true});await pw.waitFor();
  const password=await pw.inputValue(),url=await panel.getByLabel('Address',{exact:true}).inputValue(),username=await panel.getByLabel('Username',{exact:true}).inputValue();
  assert.match(password,/^nv_dav_/);assert.equal(username,'deviceqa');assert.equal(url,davOrigin+'/dav/deviceqa/');
  assert.match(await panel.innerText(),/shown only once/);
  for(const hint of [/Finder/,/Connect to Server/,/Map network drive/,/Files app/,/Documents by Readdle/])assert.match(await panel.innerText(),hint);
  // Server state: sharing on at the endpoint scope, one same-scope credential, secret not retrievable again.
  assert.equal((await api(page,'/api/profile/sharing')).body.scope,'lan');
  const list=(await api(page,'/api/profile/app-passwords')).body.appPasswords;
  assert.equal(list.length,1);assert.equal(list[0].scope,'lan');assert.equal(list[0].name,'Synthetic laptop');assert.equal(JSON.stringify(list).includes(password),false);
  // The credentials shown actually work on the file endpoint; a wrong password does not.
  const basic=p=>'Basic '+Buffer.from(username+':'+p).toString('base64');
  assert.equal((await fetch(url,{method:'OPTIONS',headers:{authorization:basic(password.slice(0,-1)+(password.endsWith('a')?'b':'a'))}})).status,401);
  assert.notEqual((await fetch(url,{method:'PROPFIND',headers:{authorization:basic(password),depth:'0'}})).status,401);
  // Copy buttons put the real value on the clipboard.
  await panel.getByRole('button',{name:'Copy App password',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),password);
  await panel.getByRole('button',{name:'Copy Address',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),url);
  if(process.env.QA_SCREENSHOTS)for(const width of [375,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/connect-${width}.png`,fullPage:true,animations:'disabled'});}
  // Escape inside the panel must not close Settings or discard the shown password.
  await panel.getByLabel('App password',{exact:true}).focus();await page.keyboard.press('Escape');
  assert.equal(await pw.isVisible(),true,'Escape keeps the password');assert.equal(await page.getByRole('region',{name:'Connect a device'}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Security and login',exact:true}).isVisible(),true,'Settings still open');
  assert.equal(await panel.locator('[role=status]').filter({hasText:'nv_dav_'}).count(),0,'password is not in a live region');
  // Closing drops the secret for good.
  await panel.getByRole('button',{name:'Done',exact:true}).click();
  await panel.waitFor({state:'detached'});
  assert.equal(await page.getByLabel('App password',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Connect a device',exact:true}).click();
  assert.equal(await page.getByLabel('App password',{exact:true}).count(),0);
  assert.equal(await page.getByRole('region',{name:'Connect a device'}).getByRole('checkbox').count(),0,'already on: no second acknowledgement');
  await page.getByRole('region',{name:'Connect a device'}).getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Connect a device','focus returns to the opener');
  // Security keeps the revoke list and links to the flow.
  // #735: the Security hint only shows when sharing is available AND eligible; loading, failing and ineligible show nothing.
  const hint=()=>page.getByRole('region',{name:'App passwords'}).getByRole('button',{name:'Open Diary & storage',exact:true});
  const openSecurity=async()=>{await page.getByRole('button',{name:'Diary & storage',exact:true}).click();await page.getByRole('button',{name:'Security and login',exact:true}).click();await page.getByRole('region',{name:'App passwords'}).getByRole('button',{name:'Revoke Synthetic laptop',exact:true}).waitFor();};
  for(const [label,fulfil] of [['ineligible (remote storage)',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...r._body,available:true,eligible:false})})],['failing',r=>r.fulfill({status:500,contentType:'application/json',body:'{}'})]]){
   const real=await api(page,'/api/profile/sharing');
   await page.route('**/api/profile/sharing',route=>route.request().method()==='GET'?fulfil({fulfill:o=>route.fulfill(o),_body:real.body}):route.continue());
   await openSecurity();
   await page.waitForTimeout(300);
   assert.equal(await hint().count(),0,'no hint when '+label);
   assert.equal(await page.getByText(/connect a device in Diary/).count(),0,'no hint text when '+label);
   await page.unroute('**/api/profile/sharing');
  }
  await openSecurity();
  await hint().waitFor();
  await page.getByRole('button',{name:'Security and login',exact:true}).click();
  await page.getByRole('region',{name:'App passwords'}).getByRole('button',{name:'Revoke Synthetic laptop',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open Diary & storage',exact:true}).click();
  await page.getByRole('button',{name:'Connect a device',exact:true}).waitFor();
  console.log('PASS connect a device: sharing on, same-scope credential, shown once, working login, copy, Security link');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit').catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(path.join(web,'.qa-tmp'),{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
