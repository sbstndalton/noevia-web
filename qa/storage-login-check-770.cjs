// #770: the storage login is checked on save, and a refresh that the storage server refuses
// (401) says the login was rejected and links to Settings → Diary & storage. Every API is
// synthetic (diary-fixture + page.route); no request leaves localhost.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs'),{navClick,openSettings}=require('./nav.cjs');
const SECRET='synthetic-app-password-qa';
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`,browser=await chromium.launch(process.env.QA_CHROME_PATH?{headless:true,executablePath:process.env.QA_CHROME_PATH}:{headless:true,channel:'chrome'}),errors=[];
 try{
  // 1. Saving: a rejected login is explained; an unreachable server saves with a warning.
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  let saveReply;const puts=[];
  await page.route('**/api/integrations/storage',r=>{const req=r.request();
   if(req.method()==='PUT'){puts.push(req.postDataJSON());return r.fulfill(saveReply());}
   return r.fulfill({json:{kind:'webdav',baseUrl:'https://dav.example.test/old',username:'old',corpusRoot:'Diary',secretConfigured:true}});});
  await page.goto(origin);await openSettings(page);
  const settings=page.getByRole('region',{name:'Settings',exact:true});
  await settings.getByRole('button',{name:'Diary & storage',exact:true}).click();
  await settings.getByLabel('Storage type').selectOption('webdav');
  await settings.getByLabel('Username').fill('nobody');await settings.getByLabel('App password').fill(SECRET);
  saveReply=()=>({status:400,json:{error:'The server rejected this username or app password.',code:'storageLoginRejected',status:401}});
  await settings.getByRole('button',{name:'Save',exact:true}).click();
  await settings.getByText('The server rejected this username or app password. Nothing was changed.',{exact:true}).waitFor({timeout:5000});
  assert.equal(await settings.getByText(/^Error:/).count(),0,'no raw "Error:" prefix');
  saveReply=()=>({json:{kind:'webdav',baseUrl:'https://dav.example.test/old',username:'nobody',corpusRoot:'Diary',secretConfigured:true,warning:'Saved, but the storage server could not be reached to check the login.',warningCode:'storageUnverified'}});
  await settings.getByLabel('App password').fill(SECRET);
  await settings.getByRole('button',{name:'Save',exact:true}).click();
  await settings.getByText('Storage saved, but the server could not be reached to check the login.',{exact:true}).waitFor({timeout:5000});
  // #773: a server that answered (403) was reached; the message names the status instead.
  saveReply=()=>({json:{kind:'webdav',baseUrl:'https://dav.example.test/old',username:'nobody',corpusRoot:'Diary',secretConfigured:true,warning:'Saved, but the login could not be checked (the storage server answered 403).',warningCode:'storageUnverified',status:403}});
  await settings.getByLabel('App password').fill(SECRET);
  await settings.getByRole('button',{name:'Save',exact:true}).click();
  await settings.getByText('Storage saved, but the login could not be checked (the server answered 403).',{exact:true}).waitFor({timeout:5000});
  assert.equal(await settings.getByText(/could not be reached/).count(),0,'a 403 does not say unreachable');
  assert.equal(puts.length,3);
  assert.ok(!(await page.content()).includes(SECRET)||await settings.getByLabel('App password').inputValue()==='', 'secret not echoed into the page');
  await page.close();

  // 2. Refresh: a 401 from storage says the login was rejected and opens Settings → Diary & storage.
  const p2=await browser.newPage({viewport:{width:1280,height:900}});p2.on('pageerror',e=>errors.push(e.message));
  const project={id:'fin',name:'Synthetic finance',goal:'',instructions:'',memories:[],files:[],chats:[],sourceFolders:['Finance'],createdAt:1,updatedAt:1};
  await p2.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;
   if(p==='/api/workspace')return r.fulfill({json:{projects:[project],freeChats:[]}});
   if(p==='/api/projects/fin/skills')return r.fulfill({json:{skills:[]}});
   if(p==='/api/projects/fin/sources/sync')return r.fulfill({json:{files:[],skipped:[{folder:'Finance',reason:'storage returned 401',retained:true}]}});
   return r.continue();});
  await p2.goto(origin);await navClick(p2,'Projects');await p2.getByText(project.name,{exact:true}).last().click();
  const toast=p2.locator('.save-error[role="alert"]');
  await toast.waitFor({timeout:10000});
  const text=await toast.textContent();
  assert.match(text,/Finance: Storage login rejected\. Check your storage credentials in Settings → Diary & storage\. Previous readable text retained\./);
  assert.ok(!/storage returned 401/.test(text),'bare status replaced');
  await toast.getByRole('button',{name:'Open storage settings',exact:true}).click();
  await p2.getByRole('region',{name:'Settings',exact:true}).getByRole('heading',{name:'Diary & storage'}).waitFor({timeout:5000});
  await p2.close();
  assert.deepEqual(errors,[]);
  console.log('PASS storage login check: rejected save explained, unverified save warned (unreachable vs answered 403), refresh 401 says login rejected and opens Settings → Diary & storage.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
