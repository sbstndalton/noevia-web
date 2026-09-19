// Plugins → MCP servers → Add (user request, 2026-09-19): an administrator adds a hosted server
// from the registry; it becomes a toolbox a project must choose; its tools ask before running even
// when the server calls them read-only; a member cannot add one; removing it takes the box away.
// Synthetic registry, synthetic MCP server, scripted model, fake Google. QA-only loopback switch.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {startFakeGoogle}=require('./fake-google.cjs');
const port=31436,llmPort=31437,regPort=31438,mcpPort=31439,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';
const NAME='io.github.synthetic/forecast';process.env.NOEVIA_QA_ALLOW_LOOPBACK_MCP='1'; // mcpItems runs here too
let calls=0;const offered=[];
function startRegistry(){const s=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({servers:[{server:{name:NAME,title:'Synthetic forecast',description:'A synthetic weather server',version:'1.0.0',remotes:[{type:'streamable-http',url:`http://127.0.0.1:${mcpPort}/mcp`}]}},{server:{name:'io.github.synthetic/local-only',description:'Runs locally',packages:[{}]}},{server:{name:'io.github.synthetic/keyed',title:'Synthetic keyed',description:'Needs an API key',remotes:[{type:'streamable-http',url:`http://127.0.0.1:${mcpPort}/keyed/mcp`,headers:[{name:'Authorization',description:'Your synthetic API key',isRequired:true,isSecret:true,value:'Bearer {api_key}'}]}]}}]}));});return new Promise(r=>s.listen(regPort,'127.0.0.1',()=>r(s)));}
let keyedAuth=[];
function startRemote(){const s=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const m=raw?JSON.parse(raw):{};
  const keyed=req.url.startsWith('/keyed');if(keyed){keyedAuth.push(req.headers.authorization||'');if(!['Bearer SYNTH-KEY-1','Bearer SYNTH-KEY-2'].includes(req.headers.authorization)){res.statusCode=401;return res.end('unauthorized');}}
  if(m.id===undefined){res.statusCode=202;return res.end();}
  res.setHeader('Content-Type','application/json');res.setHeader('mcp-session-id','synthetic-session');
  const reply=(result)=>res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  if(m.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}});
  if(m.method==='tools/list'&&keyed)return reply({tools:[{name:'synthetic_secret_lookup',description:'Look up a synthetic secret record',inputSchema:{type:'object',properties:{}}}]});
  if(m.method==='tools/list')return reply({tools:[{name:'synthetic_forecast',description:'Weather forecast for a city',inputSchema:{type:'object',properties:{city:{type:'string'}},required:['city']},annotations:{readOnlyHint:true}}]});
  if(m.method==='tools/call'){calls++;return reply({content:[{type:'text',text:`FORECAST-CANARY for ${m.params?.arguments?.city}`}]});}
  reply({});});return new Promise(r=>s.listen(mcpPort,'127.0.0.1',()=>r(s)));}
function startModel(){
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    if(req.url.endsWith('/embeddings')){res.writeHead(404);return res.end('no embedding model');}
    if(req.url.endsWith('/models')){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({data:[{id:'synthetic-model'}]}));}
    const body=raw?JSON.parse(raw):{};const names=(body.tools||[]).map(t=>t.function.name);offered.push(names);
    const last=body.messages.at(-1);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunk=(delta,finish=null)=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
    if(last.role!=='tool'&&names.includes('synthetic_forecast')){chunk({role:'assistant',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'synthetic_forecast',arguments:JSON.stringify({city:'Oslo'})}}]});chunk({},'tool_calls');}
    else chunk({role:'assistant',content:last.role==='tool'?`Tool said: ${String(last.content).slice(0,60)}`:'No forecast tool was offered.'}),chunk({},'stop');
    res.end('data: [DONE]\n\n');
  });
  return new Promise(r=>server.listen(llmPort,'127.0.0.1',()=>r(server)));
}

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-mcp-directory-'));
 const google=await startFakeGoogle({autoApprove:true});const model=await startModel();const registry=await startRegistry();const remote=await startRemote();
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,...google.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',NOEVIA_QA_ALLOW_LOOPBACK_MCP:'1',NOEVIA_QA_MCP_REGISTRY:`http://127.0.0.1:${regPort}`,
  INFERENCE_BASE_URL:`http://127.0.0.1:${llmPort}/v1`,MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 const session=()=>{const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}return {status:r.status,body:await r.json().catch(()=>null),cookies};};};
 const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('timed out');};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const admin=session();
  assert.equal((await admin('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'dirqa',displayName:'Synthetic Drive QA',password:'synthetic drive tools password',diaryEnabled:false})).status,201);
  assert.ok((await admin('/api/profile/onboarding',{})).status<300);
  // Not connected yet: no Drive tool reaches the model.
  let v=(await admin('/api/connectors')).body.connectors[0];assert.equal(v.state,'disconnected');
  assert.ok((await admin('/api/connectors/gdrive/connect',{})).status<300);
  await until(async()=>(await admin('/api/connectors')).body.connectors[0].state==='connected');

  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const {cookies}=await admin('/api/connectors');await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/plugins/directory*',async r=>{const res=await fetch(`http://127.0.0.1:${regPort}/v0/servers`);const d=await res.json();
    const {mcpItems}=require('../server/routes/plugin-directory.cjs');r.fulfill({json:{source:{label:'fixture',home:'https://example.com'},items:mcpItems(d)}});});
  await page.goto(origin);await page.getByPlaceholder('Message noevia…').waitFor();
  await page.getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('radio',{name:'MCP servers'}).click();
  await page.getByText('Runs as a program on the server; not supported').waitFor();
  await page.getByRole('button',{name:'Add Synthetic forecast to noevia'}).click();
  await page.getByText(/Added with 1 tools/).waitFor({timeout:20000});
  await page.screenshot({path:`${shots}/noevia-mcp-directory-added.png`});
  const boxId=(await admin('/api/admin/mcp-directory')).body.servers[0].id;
  // A member cannot add or list directory servers.
  const invite=await admin('/api/admin/invitations',{role:'member'});
  const other=session();
  assert.ok((await other('/api/auth/invitations/accept',{token:invite.body.token,username:'dirmember',displayName:'Other Synthetic',password:'synthetic member password here',diaryEnabled:false})).status<300);
  assert.equal((await other('/api/admin/mcp-directory',{registryName:NAME})).status,403);
  // Not offered until a project chooses the box; once chosen, the read-only-by-its-own-claim tool still asks.
  assert.ok((await admin('/api/projects',{name:'Directory QA',model:'synthetic-model',toolboxes:['core',boxId]})).status<300);
  await page.reload();await page.locator('.sidebar').getByText('Directory QA',{exact:true}).waitFor();
  await page.locator('.sidebar').getByText('Directory QA',{exact:true}).hover();await page.getByRole('button',{name:'New chat in Directory QA'}).click({force:true});
  const box=page.getByRole('textbox',{name:/Message/}).first();await box.fill('Forecast for Oslo?');await box.press('Enter');
  const card=page.locator('.tool-approval');await card.waitFor();
  assert.match(await card.innerText(),/synthetic_forecast[\s\S]*Oslo/);assert.equal(calls,0,'nothing runs before approval');
  await card.getByRole('button',{name:'Allow once'}).click();
  await page.getByText(/Tool said: FORECAST-CANARY for Oslo/).waitFor();assert.equal(calls,1);
  // Removing the server removes the box: the tool is no longer offered.
  assert.equal((await admin(`/api/admin/mcp-directory/${boxId}`,undefined,'DELETE')).status,200);
  const before=offered.length;
  await page.locator('.sidebar').getByText('Directory QA',{exact:true}).hover();await page.getByRole('button',{name:'New chat in Directory QA'}).click({force:true});
  await box.fill('Forecast again?');await box.press('Enter');await page.getByText('No forecast tool was offered.').last().waitFor();
  assert.ok(offered.slice(before).every(n=>!n.includes('synthetic_forecast')));
  // A server that needs a key: a wrong key is refused before saving, the right one is stored
  // encrypted and never returned, calls carry it, and it can be changed.
  await page.getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('radio',{name:'MCP servers'}).click();
  await page.getByText('Needs a key').waitFor();
  await page.getByRole('button',{name:'Add Synthetic keyed to noevia'}).click();
  const keyField=page.getByLabel(/Authorization/);await keyField.fill('WRONG');await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByText(/did not accept that key/).waitFor({timeout:20000});
  assert.equal((await admin('/api/admin/mcp-directory')).body.servers.length,0,'nothing saved on a wrong key');
  await keyField.fill('SYNTH-KEY-1');await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByText(/Added with 1 tools/).waitFor({timeout:20000});
  const listed=await admin('/api/admin/mcp-directory');
  assert.ok(!JSON.stringify(listed.body).includes('SYNTH-KEY'),'the key never comes back');assert.deepEqual(listed.body.servers[0].keyHeaders,['Authorization']);
  await page.screenshot({path:`${shots}/noevia-mcp-directory-key.png`});
  const keyedId=listed.body.servers[0].id;
  const direct=await admin(`/api/projects`,{name:'Keyed QA',model:'synthetic-model',toolboxes:['core',keyedId]});assert.ok(direct.status<300);
  keyedAuth.length=0;
  await page.getByRole('button',{name:'Change key for Synthetic keyed'}).click();await page.getByLabel(/Authorization/).fill('SYNTH-KEY-2');await page.getByRole('button',{name:'Save key'}).click();
  await page.getByText('Key updated.').waitFor({timeout:20000});
  assert.ok(keyedAuth.length&&keyedAuth.every(a=>a==='Bearer SYNTH-KEY-2'),`new key used ${keyedAuth}`);
  assert.equal((await other('/api/admin/mcp-directory/'+keyedId+'/keys',{headers:{Authorization:'x'}},'PUT')).status,403,'members cannot change keys');
  assert.equal((await admin(`/api/admin/mcp-directory/${keyedId}`,undefined,'DELETE')).status,200);
  assert.deepEqual(errors,[]);
  console.log('PASS mcp directory: admin adds a hosted server from the registry after it answers; local-only servers are browse-only; members get 403; its tool asks before running even when marked read-only, then runs; removing it withdraws the tool; a keyed server refuses a wrong key before saving, stores the key without ever returning it, sends it, and can change it.');
 }finally{await browser.close();server.kill();model.close();registry.close();remote.close();await google.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
