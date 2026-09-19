// Google Drive tools in a real chat, on an isolated real server: a scripted model asks for Drive
// tools, the fake Google server stands in for Drive. Proves that reads run without asking, a write
// stops at the approval card with its arguments and lands in Drive only after "Allow once", a
// blocked tool is never offered to the model, and one account never reaches another's Drive.
// Synthetic data only: no real model, no real Google.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {startFakeGoogle}=require('./fake-google.cjs');
const port=31416,llmPort=31417,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';

// A scripted OpenAI-compatible model: the user's message names the tool to call.
const offered=[];
function startModel(){
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    // No embedding model here: the tool router must fall back to every selected toolbox.
    if(req.url.endsWith('/embeddings')){res.writeHead(404);return res.end('no embedding model');}
    if(req.url.endsWith('/models')){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({data:[{id:'synthetic-model'}]}));}
    const body=raw?JSON.parse(raw):{};const names=(body.tools||[]).map(t=>t.function.name);offered.push(names);
    const last=body.messages.at(-1);const user=[...body.messages].reverse().find(m=>m.role==='user');const text=String(user?.content||'');
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunk=(delta,finish=null)=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
    const want=/create/.test(text)?['drive_create_file',{name:'synthetic-plan.md',content:'SYNTHETIC-DRIVE-CONTENT'}]:/recent/.test(text)?['drive_list_recent',{}]:null;
    if(last.role!=='tool'&&want&&names.includes(want[0])){
      chunk({role:'assistant',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:want[0],arguments:JSON.stringify(want[1])}}]});chunk({},'tool_calls');
    }else chunk({role:'assistant',content:last.role==='tool'?`Tool said: ${String(last.content).slice(0,80)}`:'No Drive tool was offered.'}),chunk({},'stop');
    res.end('data: [DONE]\n\n');
  });
  return new Promise(r=>server.listen(llmPort,'127.0.0.1',()=>r(server)));
}

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-drive-tools-'));
 const google=await startFakeGoogle({autoApprove:true});const model=await startModel();
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,...google.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',
  INFERENCE_BASE_URL:`http://127.0.0.1:${llmPort}/v1`,MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 const session=()=>{const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}return {status:r.status,body:await r.json().catch(()=>null),cookies};};};
 const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('timed out');};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const admin=session();
  assert.equal((await admin('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'driveqa',displayName:'Synthetic Drive QA',password:'synthetic drive tools password',diaryEnabled:false})).status,201);
  assert.ok((await admin('/api/profile/onboarding',{})).status<300);
  // Not connected yet: no Drive tool reaches the model.
  let v=(await admin('/api/connectors')).body.connectors[0];assert.equal(v.state,'disconnected');
  assert.ok((await admin('/api/connectors/gdrive/connect',{})).status<300);
  await until(async()=>(await admin('/api/connectors')).body.connectors[0].state==='connected');

  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const {cookies}=await admin('/api/connectors');await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  // Chats take their model from the project; this one uses the scripted model.
  assert.ok((await admin('/api/projects',{name:'Drive QA',model:'synthetic-model'})).status<300);
  const ask=async(text)=>{await page.locator('.sidebar').getByText('Drive QA',{exact:true}).hover();await page.getByRole('button',{name:'New chat in Drive QA'}).click({force:true});
    const box=page.getByRole('textbox',{name:/Message/}).first();await box.fill(text);await box.press('Enter');};
  await page.goto(origin);await page.getByPlaceholder('Message noevia…').waitFor();

  // A read runs straight through.
  await ask('Show my recent Drive files');
  await page.getByText(/Tool said: No files yet/).waitFor();
  assert.ok(offered.at(-1).includes('drive_trash_file'),'connected Drive tools are offered');

  // A write stops at the card with its arguments; nothing reaches Drive until Allow once.
  await ask('Please create a plan file');
  const card=page.locator('.tool-approval');await card.waitFor();
  assert.match(await card.innerText(),/drive_create_file[\s\S]*SYNTHETIC-DRIVE-CONTENT/);
  assert.equal([...google.files.values()].some(f=>f.name==='synthetic-plan.md'),false);
  await page.screenshot({path:`${shots}/noevia-drive-approval.png`});
  await card.getByRole('button',{name:'Allow once'}).click();
  await page.getByText(/Tool said: Created synthetic-plan\.md/).waitFor();
  assert.equal([...google.files.values()].filter(f=>f.name==='synthetic-plan.md').length,1);

  // Blocked in Settings → Connectors: the model is never offered the tool.
  assert.ok((await admin('/api/connectors/gdrive/policy',{tools:['drive_create_file'],mode:'block'},'PUT')).status<300);
  assert.equal((await admin('/api/connectors/gdrive/policy',{tools:['drive_create_file'],mode:'allow'},'PUT')).status,400,'a write cannot be allowed');
  await ask('Please create another plan file');
  await page.getByText('No Drive tool was offered.').waitFor();
  assert.equal(offered.at(-1).includes('drive_create_file'),false);
  assert.ok(offered.at(-1).includes('drive_read_file'));

  // Another account has its own, unconnected Drive and sees none of the admin's.
  const invite=await admin('/api/admin/invitations',{role:'member'});assert.equal(invite.status,201);
  const other=session();
  assert.ok((await other('/api/auth/invitations/accept',{token:invite.body.token,username:'otherqa',displayName:'Other Synthetic',password:'synthetic other account password',diaryEnabled:false})).status<300);
  v=(await other('/api/connectors')).body.connectors[0];
  assert.equal(v.state,'disconnected');assert.equal(v.backup,null);
  assert.equal(v.tools.find(t=>t.name==='drive_create_file').mode,'ask','policies are per account');
  assert.equal((await other('/api/connectors/gdrive/backup-copy',{enabled:false},'PUT')).status,403);
  assert.deepEqual(errors,[]);
  console.log('PASS drive tools live: reads run, writes wait for Allow once with full arguments and then land in Drive, a blocked tool is not offered, writes cannot be allowed, other accounts have their own Drive and policy.');
 }finally{await browser.close();server.kill();model.close();await google.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
