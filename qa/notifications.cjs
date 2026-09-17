// Background notifications end to end: opt in from Settings → Personalization, then a reply that
// finishes while the page is hidden posts one notification without chat content. Real server,
// synthetic account, fake upstream, a recording Notification stub.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const port=31295,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';
(async()=>{
 const seen=[];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;
  if(req.url.endsWith('/chat/completions')){const body=JSON.parse(raw);seen.push(body);
   if(!body.stream){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({choices:[{message:{content:'Synthetic reply.'},finish_reason:'stop'}]}));}
   res.setHeader('Content-Type','text/event-stream');return res.end('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic reply.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
  res.setHeader('Content-Type','application/json');res.end('{"data":[]}');});
 await new Promise(r=>upstream.listen(31296,'127.0.0.1',r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-notifications-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31296/v1',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];const cookies=new Map();
 const api=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}const text=await r.text();return {status:r.status,text,body:(()=>{try{return JSON.parse(text);}catch{return null;}})()};};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal((await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'notifyqa',displayName:'Synthetic Notify QA',password:'synthetic notifications password',diaryEnabled:false})).status,201);
  assert.ok((await api('/api/profile/onboarding',{})).status<300);
  const project=(await api('/api/projects',{name:'Synthetic alerts',model:'synthetic-model',toolboxes:[]})).body;
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  await ctx.addInitScript(()=>{
   window.__notes=[];window.__hidden=false;let permission='default';
   class Recording{constructor(title,options){window.__notes.push({title,body:options&&options.body,tag:options&&options.tag});}close(){}static get permission(){return permission;}static async requestPermission(){permission='granted';return permission;}}
   Object.defineProperty(window,'Notification',{value:Recording,configurable:true});
   Object.defineProperty(document,'visibilityState',{get:()=>window.__hidden?'hidden':'visible',configurable:true});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForLoadState('networkidle');
  // Opt in.
  await page.keyboard.press((await page.evaluate(()=>/mac/i.test(navigator.platform)))?'Meta+Comma':'Control+Comma');
  const dialog=page.getByRole('dialog',{name:'Settings'});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Personalization',exact:true}).click();
  const toggle=dialog.getByRole('switch',{name:'Background notifications'});
  assert.equal(await toggle.isChecked(),false,'off by default');
  await toggle.click();await page.waitForFunction(()=>localStorage.getItem('noevia:notify')==='1');
  assert.equal(await toggle.isChecked(),true);
  await page.screenshot({path:`${shots}/notifications-settings-1440.png`});
  await page.keyboard.press('Escape');
  // A reply while visible: nothing. A reply while hidden: one generic notification.
  await page.locator('.sidebar').getByText('Synthetic alerts',{exact:true}).hover();await page.getByRole('button',{name:'New chat in Synthetic alerts'}).click({force:true});await page.getByText('Synthetic alerts').nth(1).waitFor();
  const box=page.getByRole('textbox',{name:/Message/}).first();
  await box.fill('Visible question PRIVATE-TEXT');await box.press('Enter');
await page.getByText('Synthetic reply.').first().waitFor();await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>window.__notes),[]);
  await page.evaluate(()=>{window.__hidden=true;});
  await box.fill('Hidden question PRIVATE-TEXT');await box.press('Enter');
  await page.waitForFunction(()=>window.__notes.length===1,null,{timeout:20000});
  const notes=await page.evaluate(()=>window.__notes);
  assert.equal(notes[0].title,'Reply ready');assert.match(notes[0].tag,/^reply-/);
  assert.ok(!JSON.stringify(notes).includes('PRIVATE-TEXT'),'no chat content in notifications');
  assert.deepEqual(errors,[]);
  console.log('PASS notifications: opt-in switch requests permission, silent while visible, one content-free notification when a reply finishes in the background.');
 }finally{await browser.close();server.kill('SIGTERM');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
