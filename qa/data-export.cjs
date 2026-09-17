// Settings → Data → Export conversations, end to end on an isolated real server with a synthetic
// account: seeds a free chat and a project chat, downloads the ZIP through the UI and checks it.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const port=31291,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';
function entries(buf){const out={};let at=0;while(buf.readUInt32LE(at)===0x04034b50){const size=buf.readUInt32LE(at+18),n=buf.readUInt16LE(at+26),x=buf.readUInt16LE(at+28),name=buf.toString('utf8',at+30,at+30+n),data=buf.subarray(at+30+n+x,at+30+n+x+size);assert.equal(zlib.crc32(data),buf.readUInt32LE(at+14));out[name]=data.toString('utf8');at+=30+n+x+size;}return out;}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-data-export-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:1/v1',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];const cookies=new Map();
 const api=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}return {status:r.status,body:await r.json().catch(()=>null)};};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal((await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'exportqa',displayName:'Synthetic Export QA',password:'synthetic data export password',diaryEnabled:false})).status,201);
  assert.ok((await api('/api/profile/onboarding',{})).status<300);
  assert.equal((await fetch(origin+'/api/export/conversations')).status,401,'signed out');
  // Seed: one free chat and one project chat, each with a short synthetic transcript.
  assert.ok((await api('/api/freechats',{chats:[{id:'c-free-1',title:'Synthetic packing list',updatedAt:Date.now()}]})).status<300);
  assert.ok((await api('/api/chats/c-free-1/history',{history:[{role:'user',content:'What should I pack?'},{role:'assistant',content:'A **synthetic** list.',reasoning:'PRIVATE-REASONING-CANARY'}]})).status<300);
  const created=await api('/api/projects',{name:'Synthetic battery notes',toolboxes:[]});const project=created.body.project||created.body;
  assert.ok((await api(`/api/projects/${project.id}/chats`,{chats:[{id:'c-proj-1',title:'Cell chemistry',updatedAt:Date.now()}]})).status<300);
  assert.ok((await api('/api/chats/c-proj-1/history',{history:[{role:'user',content:'Which chemistry?'},{role:'assistant',content:'Synthetic answer.'}]})).status<300);

  const ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const [width,theme] of [[1440,'light'],[375,'dark']]){
   await page.setViewportSize({width,height:width<768?760:900});await page.emulateMedia({colorScheme:theme});
   await page.goto(origin);await page.waitForLoadState('networkidle');
   const nav=page.getByRole('button',{name:'Open navigation',exact:true});if(await nav.isVisible().catch(()=>false))await nav.click();
   await page.getByRole('button',{name:/Account menu for/}).click();await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();
   const dialog=page.getByRole('dialog',{name:'Settings'});await dialog.waitFor();
   if(width<768)await dialog.getByLabel('Settings category').selectOption('data');else await dialog.getByRole('button',{name:'Data',exact:true}).click();
   await dialog.getByRole('heading',{name:'Data',level:1}).waitFor();
   assert.equal(await dialog.getByText('Export conversations',{exact:true}).count(),1);
   const [download]=await Promise.all([page.waitForEvent('download'),dialog.getByRole('button',{name:'Export',exact:true}).click()]);
   assert.match(download.suggestedFilename(),/^noevia-conversations-\d{4}-\d{2}-\d{2}\.zip$/);
   const files=entries(fs.readFileSync(await download.path()));
   const names=Object.keys(files);
   assert.ok(names.includes('chats/synthetic-packing-list-c-free-1.md'),names.join(', '));
   assert.ok(names.includes('projects/synthetic-battery-notes/cell-chemistry-c-proj-1.md'),names.join(', '));
   assert.match(files['chats/synthetic-packing-list-c-free-1.md'],/## Assistant\n\nA \*\*synthetic\*\* list\./);
   assert.ok(!Object.values(files).some(t=>t.includes('PRIVATE-REASONING-CANARY')),'reasoning must not be exported');
   assert.equal(JSON.parse(files['conversations.json']).chats.length,2);
   await dialog.getByRole('status').filter({hasText:'Downloaded'}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);
   await page.screenshot({path:`${shots}/data-export-${width}-${theme}.png`});
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS data export: Settings → Data downloads a ZIP with free and project chats as Markdown plus JSON, no reasoning text, signed-out 401; 1440 light, 375 dark.');
 }finally{await browser.close();server.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
