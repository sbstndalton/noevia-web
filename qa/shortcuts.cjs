// Global keyboard shortcuts against synthetic APIs: ⌘/Ctrl+/ help, +, Settings, +K search, +⇧O new chat.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'/tmp';
(async()=>{
 const fixture=createFixture(31358);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname,json=b=>route.fulfill({json:b});
   if(p==='/api/profile'||p==='/api/auth/session')return json({user:{id:'qa',username:'keysqa',displayName:'Keys QA',role:'admin',diaryEnabled:true,onboarded:true},passkeys:[]});
   if(p==='/api/models/installed')return json([]);return route.continue();});
  await page.goto('http://localhost:31358');await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  const mod=await page.evaluate(()=>/mac|iphone|ipad/i.test(navigator.platform)?'Meta':'Control');
  // Help lists every shortcut with the platform's key names.
  await page.keyboard.press(`${mod}+Slash`);
  const help=page.getByRole('dialog',{name:'Keyboard shortcuts'});await help.waitFor();
  const text=await help.innerText();
  for(const label of ['Search projects and chats','New chat','Open Settings','Show keyboard shortcuts'])assert.ok(text.includes(label),label);
  assert.ok(text.includes(mod==='Meta'?'⌘K':'Ctrl+K'),text);
  for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.screenshot({path:`${shots}/shortcuts-1440-${theme}.png`});}
  await page.keyboard.press('Escape');await help.waitFor({state:'detached'});
  // Settings opens and closes.
  await page.keyboard.press(`${mod}+Comma`);const settings=page.getByRole('dialog',{name:'Settings'});await settings.waitFor();
  assert.equal(await settings.getByText('Keyboard shortcuts',{exact:true}).count(),0,'no longer listed as planned');
  await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
  // Search opens the rail's field with focus, even from inside the message box.
  await page.getByRole('textbox',{name:'Message',exact:true}).click();
  await page.keyboard.press(`${mod}+KeyK`);
  const search=page.getByRole('textbox',{name:'Search projects and chats'});await search.waitFor();
  assert.equal(await search.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');
  // New chat lands in an empty chat.
  await page.keyboard.press(`${mod}+Shift+KeyO`);await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  // Plain letters never trigger anything while typing.
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('');await page.keyboard.type('k/,');
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS shortcuts: help lists platform keys, Settings, search focus from the composer, new chat, plain typing untouched; light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
