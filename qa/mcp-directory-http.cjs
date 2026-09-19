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
function startRegistry(){const s=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({servers:[{server:{name:NAME,title:'Synthetic forecast',description:'A synthetic weather server',version:'1.0.0',remotes:[{type:'streamable-http',url:`http://127.0.0.1:${mcpPort}/mcp`}]}},{server:{name:'io.github.synthetic/local-only',description:'Runs locally',packages:[{}]}},{server:{name:'io.github.synthetic/keyed',title:'Synthetic keyed',description:'Needs an API key',remotes:[{type:'streamable-http',url:`http://127.0.0.1:${mcpPort}/keyed/mcp`,headers:[{name:'Authorization',description:'Your synthetic API key',isRequired:true,isSecret:true,value:'Bearer {api_key}'}]}]}},{server:{name:'io.github.synthetic/oauth',title:'Synthetic oauth',description:'Signs in with OAuth',remotes:[{type:'streamable-http',url:`http://127.0.0.1:${mcpPort}/oauth/mcp`}]}},{server:{name:'io.github.synthetic/manual',title:'Synthetic manual',description:'Needs a hand-registered app',remotes:[{type:'streamable-http',url:`http://127.0.0.1:${mcpPort}/manual/mcp`}]}}]}));});return new Promise(r=>s.listen(regPort,'127.0.0.1',()=>r(s)));}
let keyedAuth=[];const oauthCalls=[];const codes=new Map();let issued=0;
const crypto=require('node:crypto');
function startRemote(){const s=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;let m={};try{m=raw?JSON.parse(raw):{};}catch{m={};}
  const U=new URL(req.url,'http://x'),base=`http://127.0.0.1:${mcpPort}`;
  const sendJson=(o,st=200)=>{res.statusCode=st;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(o));};
  if(U.pathname==='/.well-known/oauth-protected-resource/oauth/mcp')return sendJson({resource:`${base}/oauth/mcp`,authorization_servers:[`${base}/as`]});
  if(U.pathname==='/.well-known/oauth-authorization-server/as')return sendJson({issuer:`${base}/as`,authorization_endpoint:`${base}/as/authorize`,token_endpoint:`${base}/as/token`,registration_endpoint:`${base}/as/register`,code_challenge_methods_supported:['S256']});
  if(U.pathname==='/as/register')return sendJson({client_id:'synthetic-client'},201);
  // A second service with no self-registration: only the hand-registered app gets tokens.
  if(U.pathname==='/.well-known/oauth-protected-resource/manual/mcp')return sendJson({resource:`${base}/manual/mcp`,authorization_servers:[`${base}/as2`]});
  if(U.pathname==='/.well-known/oauth-authorization-server/as2')return sendJson({issuer:`${base}/as2`,authorization_endpoint:`${base}/as2/authorize`,token_endpoint:`${base}/as2/token`,code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['client_secret_basic']});
  if(U.pathname==='/as2/authorize'){if(U.searchParams.get('client_id')!=='manual-client'){res.statusCode=400;return res.end('unknown client');}const code='M'+Math.random().toString(36).slice(2);codes.set(code,U.searchParams.get('code_challenge'));res.statusCode=302;res.setHeader('Location',`${U.searchParams.get('redirect_uri')}?code=${code}&state=${U.searchParams.get('state')}`);return res.end();}
  if(U.pathname==='/as2/token'){if(req.headers.authorization!==`Basic ${Buffer.from('manual-client:MANUAL-SECRET').toString('base64')}`)return sendJson({error:'invalid_client'},401);const q=new URLSearchParams(raw);const ch=codes.get(q.get('code'));if(!ch||crypto.createHash('sha256').update(q.get('code_verifier')||'').digest('base64url')!==ch)return sendJson({error:'invalid_grant'},400);codes.delete(q.get('code'));return sendJson({access_token:`TOKEN-${++issued}`,expires_in:3600});}
  if(U.pathname==='/manual/mcp'){const a=req.headers.authorization||'';if(!/^Bearer TOKEN-\d+$/.test(a)){res.statusCode=401;res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/manual/mcp"`);return res.end();}}
  const manualPath=U.pathname==='/manual/mcp';
  if(U.pathname==='/as/authorize'){const code='C'+Math.random().toString(36).slice(2);codes.set(code,U.searchParams.get('code_challenge'));res.statusCode=302;res.setHeader('Location',`${U.searchParams.get('redirect_uri')}?code=${code}&state=${U.searchParams.get('state')}`);return res.end();}
  if(U.pathname==='/as/token'){const q=new URLSearchParams(raw);const ch=codes.get(q.get('code'));if(!ch||crypto.createHash('sha256').update(q.get('code_verifier')||'').digest('base64url')!==ch)return sendJson({error:'invalid_grant'},400);codes.delete(q.get('code'));return sendJson({access_token:`TOKEN-${++issued}`,expires_in:3600});}
  if(U.pathname==='/oauth/mcp'){const a=req.headers.authorization||'';if(!/^Bearer TOKEN-\d+$/.test(a)){res.statusCode=401;res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/oauth/mcp"`);return res.end();}
    if(m.method==='tools/call')oauthCalls.push(a);}
  const oauthPath=U.pathname==='/oauth/mcp';
  const keyed=req.url.startsWith('/keyed');if(keyed){keyedAuth.push(req.headers.authorization||'');if(!['Bearer SYNTH-KEY-1','Bearer SYNTH-KEY-2'].includes(req.headers.authorization)){res.statusCode=401;return res.end('unauthorized');}}
  if(m.id===undefined){res.statusCode=202;return res.end();}
  res.setHeader('Content-Type','application/json');res.setHeader('mcp-session-id','synthetic-session');
  const reply=(result)=>res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  if(m.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}});
  if(m.method==='tools/list'&&manualPath)return reply({tools:[{name:'synthetic_manual_tool',description:'A tool behind a hand-registered app',inputSchema:{type:'object',properties:{}}}]});
  if(m.method==='tools/list'&&oauthPath)return reply({tools:[{name:'synthetic_my_notes',description:'List my synthetic notes',inputSchema:{type:'object',properties:{}}}]});
  if(m.method==='tools/call'&&oauthPath)return reply({content:[{type:'text',text:`NOTES for ${req.headers.authorization}`}]});
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
    if(last.role!=='tool'&&names.includes('synthetic_my_notes')){chunk({role:'assistant',tool_calls:[{index:0,id:'call-n',type:'function',function:{name:'synthetic_my_notes',arguments:'{}'}}]});chunk({},'tool_calls');}
    else if(last.role!=='tool'&&names.includes('synthetic_forecast')){chunk({role:'assistant',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'synthetic_forecast',arguments:JSON.stringify({city:'Oslo'})}}]});chunk({},'tool_calls');}
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
  await page.getByText(/Added with 1 tool\b/).waitFor({timeout:20000});
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
  await page.getByText(/Added with 1 tool\b/).waitFor({timeout:20000});
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
  // OAuth: the admin adds a sign-in server (a new tab signs in and comes back); tools are listed
  // with the admin's sign-in. A member is not offered them until they sign in with their own
  // account, and each account's calls carry its own token.
  await page.getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('radio',{name:'MCP servers'}).click();
  const [tab]=await Promise.all([page.context().waitForEvent('page'),page.getByRole('button',{name:'Add Synthetic oauth to noevia'}).click()]);
  await tab.getByText('Signed in').waitFor({timeout:20000});await tab.close().catch(()=>{});
  await page.getByText(/Signed in\. 1 tool available/).waitFor({timeout:30000});
  const oauthId=(await admin('/api/admin/mcp-directory')).body.servers.find(x=>x.oauth).id;
  // Member: project with the box, but no sign-in yet → not offered.
  const mctx=await browser.newContext({viewport:{width:1280,height:900}});
  const {cookies:mc}=await other('/api/connectors');await mctx.addCookies([...mc].map(([name,value])=>({name,value,url:origin})));
  assert.ok((await other('/api/projects',{name:'Member OAuth',model:'synthetic-model',toolboxes:['core',oauthId]})).status<300);
  await other('/api/profile/onboarding',{});
  const mp=await mctx.newPage();mp.on('pageerror',e=>errors.push(e.message));await mp.goto(origin);
  const mset=mp.getByRole('region',{name:'Settings'});await mset.or(mp.locator('.sidebar').getByText('Member OAuth',{exact:true})).first().waitFor();
  if(await mset.isVisible().catch(()=>false)){await mp.keyboard.press('Escape');await mset.waitFor({state:'detached'});}
  await mp.locator('.sidebar').getByText('Member OAuth',{exact:true}).waitFor({timeout:10000}).catch(async e=>{await mp.screenshot({path:'/tmp/noevia-shots/member-land.png'});throw e;});
  const mask=async(text)=>{await mp.locator('.sidebar').getByText('Member OAuth',{exact:true}).hover();await mp.getByRole('button',{name:'New chat in Member OAuth'}).click({force:true});const b=mp.getByRole('textbox',{name:/Message/}).first();await b.fill(text);await b.press('Enter');};
  const b0=offered.length;await mask('Show my notes');await mp.getByText('No forecast tool was offered.').last().waitFor();
  assert.ok(offered.slice(b0).every(n=>!n.includes('synthetic_my_notes')),'not offered before the member signs in');
  await mp.getByRole('button',{name:'Plugins',exact:true}).click();
  const [mtab]=await Promise.all([mctx.waitForEvent('page'),mp.getByRole('button',{name:'Sign in to Synthetic oauth'}).click()]);
  await mtab.getByText('Signed in').waitFor({timeout:20000});await mtab.close().catch(()=>{});
  await mp.getByRole('button',{name:'Disconnect Synthetic oauth'}).waitFor({timeout:20000});
  await mp.screenshot({path:`${shots}/noevia-mcp-oauth-member.png`});
  await mask('Show my notes please');const mcard=mp.locator('.tool-approval');await mcard.waitFor();await mcard.getByRole('button',{name:'Allow once'}).click();
  await mp.getByText(/Tool said: NOTES for Bearer TOKEN-/).last().waitFor();
  const memberToken=oauthCalls.at(-1);
  // The admin's own call uses the admin's token, not the member's.
  assert.ok((await admin('/api/projects',{name:'Admin OAuth',model:'synthetic-model',toolboxes:['core',oauthId]})).status<300);
  await page.reload();await page.locator('.sidebar').getByText('Admin OAuth',{exact:true}).waitFor();
  await page.locator('.sidebar').getByText('Admin OAuth',{exact:true}).hover();await page.getByRole('button',{name:'New chat in Admin OAuth'}).click({force:true});
  const ab=page.getByRole('textbox',{name:/Message/}).first();await ab.fill('Show my notes');await ab.press('Enter');
  const acard=page.locator('.tool-approval');await acard.waitFor();await acard.getByRole('button',{name:'Allow once'}).click();
  await page.getByText(/Tool said: NOTES for Bearer TOKEN-/).last().waitFor();
  assert.notEqual(oauthCalls.at(-1),memberToken,'each account calls with its own token');
  // Removing the server drops every account's sign-in.
  assert.equal((await admin(`/api/admin/mcp-directory/${oauthId}`,undefined,'DELETE')).status,200);
  assert.deepEqual((await other('/api/mcp-oauth/servers')).body.servers,[]);
  await mctx.close();
  // A service with no self-registration: the admin is shown the return address, enters the
  // hand-registered app (a wrong secret gets no token), and then signs in as usual.
  await page.getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('radio',{name:'MCP servers'}).click();
  const [t0]=await Promise.all([page.context().waitForEvent('page').catch(()=>null),page.getByRole('button',{name:'Add Synthetic manual to noevia'}).click()]);
  await page.getByText(/does not let apps register themselves/).waitFor({timeout:20000});
  assert.match(await page.locator('.plugin-copy code').innerText(),/\/api\/mcp-oauth\/callback$/);
  await page.getByLabel('Client ID').fill('manual-client');await page.getByLabel(/Client secret/).fill('WRONG-SECRET');
  const [bad]=await Promise.all([page.context().waitForEvent('page'),page.getByRole('button',{name:'Save and sign in'}).click()]);
  await bad.getByText(/Sign-in did not finish/).waitFor({timeout:20000});assert.match(await bad.locator('body').innerText(),/did not issue a token/);await bad.close();
  const manualId=(await admin('/api/admin/mcp-directory')).body.servers.find(x=>x.registryName==='io.github.synthetic/manual').id;
  assert.ok(!JSON.stringify((await admin('/api/admin/mcp-directory')).body).includes('WRONG-SECRET'),'the secret never comes back');
  await page.getByRole('button',{name:'App settings'}).last().click();await page.getByLabel(/Client secret/).fill('MANUAL-SECRET');
  const [good]=await Promise.all([page.context().waitForEvent('page'),page.getByRole('button',{name:'Save and sign in'}).click()]);
  await good.getByText('Signed in').waitFor({timeout:20000});await good.close();
  await page.getByText(/Signed in\. 1 tool available/).last().waitFor({timeout:30000});
  await page.screenshot({path:`${shots}/noevia-mcp-manual-app.png`});
  const manualRow=(await admin('/api/admin/mcp-directory')).body.servers.find(x=>x.id===manualId);
  assert.equal(manualRow.toolCount,1);assert.deepEqual([manualRow.oauthClient.manual,manualRow.oauthClient.clientId,manualRow.oauthClient.hasSecret],[true,'manual-client',true]);
  assert.equal((await other(`/api/admin/mcp-directory/${manualId}/oauth-client`,{clientId:'x'},'PUT')).status,403,'members cannot set the app');
  assert.equal((await admin(`/api/admin/mcp-directory/${manualId}`,undefined,'DELETE')).status,200);
  assert.deepEqual(errors,[]);
  console.log('PASS mcp directory: admin adds a hosted server from the registry after it answers; local-only servers are browse-only; members get 403; its tool asks before running even when marked read-only, then runs; removing it withdraws the tool; a keyed server refuses a wrong key before saving, stores the key without ever returning it, sends it, and can change it; an OAuth server is added through a sign-in tab, is offered to a member only after their own sign-in, and each account calls with its own token; a service without self-registration takes a hand-registered app (wrong secret refused, secret never returned).');
 }finally{await browser.close();server.kill();model.close();registry.close();remote.close();await google.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
