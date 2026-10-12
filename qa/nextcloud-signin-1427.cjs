// #1427: Nextcloud sign-in is the obvious path in Settings → Diary & storage. A saved internal
// WebDAV URL is not used as the sign-in address, the window opens inside the click, the page polls
// by itself until Nextcloud hands over the app password, failures say what happened, and the manual
// WebDAV form stays reachable. Every API is synthetic (diary-fixture + page.route); nothing leaves
// localhost. Run against a build: QA_DIST=dist node qa/nextcloud-signin-1427.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs'),{openSettings}=require('./nav.cjs');
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`;
 const browser=await chromium.launch(process.env.QA_CHROME_PATH?{headless:true,executablePath:process.env.QA_CHROME_PATH}:{headless:true,channel:'chrome'}),errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const saved={kind:'webdav',baseUrl:'http://10.0.0.5:11000/remote.php/dav/files/ada',username:'ada@example.test',corpusRoot:'Documents/Diary',secretConfigured:true};
  let startReply=()=>({json:{flowId:'flow-1',loginUrl:`${origin}/synthetic-nextcloud-login`,expiresAt:Date.now()+600000}});
  const polls=[],cancels=[],storageGets=[];let pollReplies=[],pollDelay=0;
  await context.route('**/synthetic-nextcloud-login',r=>r.fulfill({contentType:'text/html',body:'<title>Synthetic Nextcloud</title><p>Connect to your account</p>'}));
  await page.route('**/api/integrations/storage**',r=>{const req=r.request(),p=new URL(req.url()).pathname;
   if(p==='/api/integrations/storage'&&req.method()==='GET'){storageGets.push(Date.now());return r.fulfill({json:saved});}
   if(p.endsWith('/nextcloud/cancel')){cancels.push(req.postDataJSON());return r.fulfill({json:{cancelled:true}});}
   if(p.endsWith('/nextcloud/start'))return r.fulfill(startReply(req.postDataJSON()));
   if(p.endsWith('/nextcloud/poll')){polls.push(req.postDataJSON());const reply=pollReplies.shift()||{status:202,json:{pending:true}};return pollDelay?new Promise(res=>setTimeout(()=>res(r.fulfill(reply)),pollDelay)):r.fulfill(reply);}
   return r.fulfill({status:500,json:{error:'unexpected '+p}});});
  await page.goto(origin);await openSettings(page);
  const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  await settings.getByRole('button',{name:'Diary & storage',exact:true}).click();
  // 1. A saved Nextcloud WebDAV URL offers the sign-in; the internal http address is not reused.
  await settings.getByText('This looks like a Nextcloud server.',{exact:false}).waitFor({timeout:5000});
  await settings.getByRole('button',{name:'Sign in with Nextcloud instead',exact:true}).click();
  const address=settings.getByLabel('Nextcloud address');
  assert.equal(await address.inputValue(),'','internal http WebDAV URL is not the sign-in address');
  assert.equal(await settings.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).isDisabled(),true);
  assert.equal(await settings.getByLabel('Corpus folder').inputValue(),'Documents/Diary');
  // 2. Errors say what happened.
  await address.fill('https://cloud.example.test');
  startReply=()=>({status:504,json:{error:'x',code:'nextcloudUnreachable',reason:'timeout'}});
  await settings.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click();
  await settings.getByRole('alert').filter({hasText:'Nextcloud did not answer within 10 seconds.'}).waitFor({timeout:5000});
  startReply=()=>({status:429,json:{error:'x',code:'nextcloudThrottled',retryAfter:600}});
  await settings.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click();
  await settings.getByRole('alert').filter({hasText:'throttling sign-ins from noevia'}).waitFor({timeout:5000});
  assert.match(await settings.getByRole('alert').textContent(),/about 10 min/);
  assert.equal(await settings.getByText(/^Error:/).count(),0,'no raw "Error:" prefix');
  // 3. The sign-in window opens from the click, the page polls, and the result is shown.
  startReply=()=>({json:{flowId:'flow-1',loginUrl:`${origin}/synthetic-nextcloud-login`,expiresAt:Date.now()+600000}});
  pollReplies=[{status:202,json:{pending:true}},{json:{kind:'nextcloud',baseUrl:'https://cloud.example.test/remote.php/dav/files/Ada%20L',username:'ada@example.test',corpusRoot:'Documents/Diary',secretConfigured:true}}];
  const [popup]=await Promise.all([context.waitForEvent('page'),settings.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click()]);
  await popup.waitForURL('**/synthetic-nextcloud-login');
  await settings.getByText('Waiting for you to sign in',{exact:false}).waitFor({timeout:5000});
  await settings.getByText('Nextcloud connected as ada@example.test.',{exact:false}).waitFor({timeout:10000});
  assert.equal(polls.length,2);assert.deepEqual(polls[0],{flowId:'flow-1',corpusRoot:'Documents/Diary'});
  assert.equal(await settings.getByRole('button',{name:'Sign in again',exact:true}).isVisible(),true);
  assert.equal(await address.inputValue(),'https://cloud.example.test');
  await popup.close();
  // 4. A blocked window still leaves a way through: a link to the sign-in page.
  await page.addInitScript(()=>{window.open=()=>null;});
  await page.evaluate(()=>{window.open=()=>null;});
  pollReplies=[{status:400,json:{error:'login flow expired',code:'nextcloudFlowExpired'}}];
  await settings.getByRole('button',{name:'Sign in again',exact:true}).click();
  await settings.getByText('Your browser blocked the Nextcloud window.',{exact:false}).waitFor({timeout:5000});
  assert.equal(await settings.getByRole('link',{name:'Open the Nextcloud sign-in page',exact:true}).getAttribute('href'),`${origin}/synthetic-nextcloud-login`);
  await settings.getByRole('alert').filter({hasText:'The sign-in expired before access was granted.'}).waitFor({timeout:10000});
  // 5. #1433: Cancel ends the flow on the server, and a cancel that races a poll which saved
  // re-reads the connection and shows it.
  await page.evaluate(()=>{window.open=()=>null;});
  pollReplies=[];
  await settings.getByRole('button',{name:'Sign in again',exact:true}).click();
  await settings.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
  await page.waitForTimeout(300);
  assert.deepEqual(cancels.at(-1),{flowId:'flow-1'});
  assert.equal(await settings.getByRole('button',{name:'Sign in again',exact:true}).isVisible(),true);
  const racedRow={kind:'nextcloud',baseUrl:'https://cloud.example.test/remote.php/dav/files/Grace',username:'grace@example.test',corpusRoot:'Documents/Diary',secretConfigured:true};
  pollDelay=1500;pollReplies=[{json:racedRow}];
  await settings.getByRole('button',{name:'Sign in again',exact:true}).click();
  await page.waitForTimeout(2300); // the first poll (after 2 s) is now in flight
  const getsBefore=storageGets.length;Object.assign(saved,racedRow);
  await settings.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
  await settings.getByText('Nextcloud connected as grace@example.test.',{exact:false}).waitFor({timeout:5000});
  assert.ok(storageGets.length>getsBefore,'the saved connection was read again after the race');
  pollDelay=0;
  // 6. The manual WebDAV form is still there under Advanced.
  await settings.getByText('Advanced: other WebDAV server or app password',{exact:true}).click();
  await settings.getByRole('button',{name:'Enter WebDAV details by hand',exact:true}).click();
  await settings.getByLabel('App password').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS #1427 Nextcloud sign-in: internal WebDAV URL not reused, timeout/throttle explained, popup opens from the click, auto-poll connects, blocked popup gets a link, expiry explained, cancel ends the server flow and a raced save is re-read, manual WebDAV under Advanced.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
