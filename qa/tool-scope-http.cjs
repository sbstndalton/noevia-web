// The tool router in a real chat (user request, 2026-09-19): each message gets only the matching
// toolboxes, the reply says which ("Using: …"), and the model can ask once for the rest.
// Scripted model and embeddings, fake Google; synthetic data only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {startFakeGoogle}=require('./fake-google.cjs');
const port=31426,llmPort=31427,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';


const offered=[],systems=[];
// Two-dimensional embeddings: anything about Drive/files points one way, everything else the other.
const vec=t=>/drive/i.test(t)?[1,0.05]:[0.05,1];
function startModel(){
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    const json=(o)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));};
    if(req.url.endsWith('/models'))return json({data:[{id:'synthetic-model'}]});
    const body=raw?JSON.parse(raw):{};
    if(req.url.endsWith('/embeddings'))return json({data:[].concat(body.input).map((t,i)=>({index:i,embedding:vec(String(t))}))});
    const names=(body.tools||[]).map(t=>t.function.name);offered.push(names);systems.push((body.messages||[]).filter(m=>m.role==='system').map(m=>String(m.content)).join('\n'));
    const last=body.messages.at(-1);const user=[...body.messages].reverse().find(m=>m.role==='user');const text=String(user?.content||'');
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunk=(delta,finish=null)=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
    const call=(name,args={})=>{chunk({role:'assistant',tool_calls:[{index:0,id:'call-'+offered.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls');};
    if(/recent drive/i.test(text)&&last.role!=='tool'&&names.includes('drive_list_recent'))call('drive_list_recent');
    // Needs a Core tool while only Drive was offered: ask for more, then use it.
    else if(/calculate/i.test(text)&&!names.some(n=>!n.startsWith('drive_')&&n!=='more_tools')&&names.includes('more_tools'))call('more_tools');
    else chunk({role:'assistant',content:`Offered ${names.length} tools${names.some(n=>!n.startsWith('drive_')&&n!=='more_tools')?' including Core':''}.`}),chunk({},'stop');
    res.end('data: [DONE]\n\n');
  });
  return new Promise(r=>server.listen(llmPort,'127.0.0.1',()=>r(server)));
}

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-tool-scope-'));
 const google=await startFakeGoogle({autoApprove:true});const model=await startModel();
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,...google.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',NOEVIA_FEATURE_TOOL_ROUTER:'true',
  INFERENCE_BASE_URL:`http://127.0.0.1:${llmPort}/v1`,MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 const session=()=>{const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}return {status:r.status,body:await r.json().catch(()=>null),cookies};};};
 const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('timed out');};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const admin=session();
  assert.equal((await admin('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'scopeqa',displayName:'Synthetic Drive QA',password:'synthetic drive tools password',diaryEnabled:false})).status,201);
  assert.ok((await admin('/api/profile/onboarding',{})).status<300);
  // Not connected yet: no Drive tool reaches the model.
  let v=(await admin('/api/connectors')).body.connectors[0];assert.equal(v.state,'disconnected');
  assert.ok((await admin('/api/connectors/gdrive/connect',{})).status<300);
  await until(async()=>(await admin('/api/connectors')).body.connectors[0].state==='connected');

  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const {cookies}=await admin('/api/connectors');await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  assert.ok((await admin('/api/projects',{name:'Scope QA',model:'synthetic-model'})).status<300);
  const ask=async(text)=>{await page.locator('.sidebar').getByText('Scope QA',{exact:true}).hover();await page.getByRole('button',{name:'New chat in Scope QA'}).click({force:true});
    const box=page.getByRole('textbox',{name:/Message/}).first();await box.fill(text);await box.press('Enter');};
  await page.goto(origin);await page.getByPlaceholder('Message noevia…').waitFor();

  // A Drive request gets only Drive (plus the ask-for-more tool), and says so.
  await ask('Show my recent drive files');
  await page.getByText(/Offered \d+ tools\./).first().waitFor({timeout:15000}).catch(async e=>{console.log(JSON.stringify(offered));console.log((await page.locator('.transcript').innerText()).slice(-600));throw e;});
  const first=offered.find(n=>n.includes('drive_list_recent'));
  assert.ok(first&&first.every(n=>n.startsWith('drive_')||n==='more_tools')&&first.includes('more_tools'),`only Drive offered ${first}`);
  assert.match(await page.locator('.tool-scope').last().innerText(),/Using: Google Drive/);
  await page.screenshot({path:`${shots}/noevia-tool-scope.png`});

  // Routed to Drive but needs Core: the model asks once and gets the project's full selection.
  const before=offered.length;
  await ask('Please calculate something about my drive files');
  await page.getByText(/including Core/).waitFor();
  const rounds=offered.slice(before);
  assert.ok(rounds[0].includes('more_tools')&&!rounds[0].some(n=>!n.startsWith('drive_')&&n!=='more_tools'),`first round is Drive only ${rounds[0]}`);
  assert.ok(rounds.at(-1).some(n=>!n.startsWith('drive_')&&n!=='more_tools'),'after asking, Core is offered');
  assert.match(await page.locator('.tool-scope').last().innerText(),/Using: all tools/);
  // Skill auto-loading: an enabled skill whose description matches the message has its reviewed
  // body in the prompt, and the reply says so; an unrelated message gets only the index.
  const skillBody='SKILL-BODY-CANARY: list the three newest files first.';
  const sp=(await admin('/api/projects',{name:'Skill QA',model:'synthetic-model',files:[{name:'drive-report/SKILL.md',content:`---\nname: Drive report\ndescription: Summarise the files in my Google Drive\n---\n${skillBody}`}]})).body;
  const route=`/api/projects/${sp.id}/instruction-skills`;const listed=(await admin(route)).body.skills[0];
  assert.equal((await admin(route,{file:listed.file,hash:listed.hash,enabled:true},'PUT')).status,200);
  await page.reload();await page.getByPlaceholder(/Message/).first().waitFor();
  const askIn=async(text)=>{await page.locator('.sidebar').getByText('Skill QA',{exact:true}).hover();await page.getByRole('button',{name:'New chat in Skill QA'}).click({force:true});
    const box=page.getByRole('textbox',{name:/Message/}).first();await box.fill(text);await box.press('Enter');};
  const sys=()=>systems.at(-1)||'';
  await askIn('Summarise my drive please');await page.getByText(/Offered \d+ tools/).last().waitFor();
  assert.ok(sys().includes('SKILL-BODY-CANARY'),'matched skill body is in the prompt');
  await page.locator('.tool-scope',{hasText:'Skill: Drive report'}).last().waitFor();
  await askIn('Tell me a joke');await page.waitForFunction(n=>document.querySelectorAll('.msg[data-role=assistant]').length>=1,1);await page.waitForTimeout(800);
  assert.ok(!sys().includes('SKILL-BODY-CANARY')&&sys().includes('Drive report'),'unrelated message: index only');
  await page.screenshot({path:`${shots}/noevia-skill-scope.png`});
  // Plugins → Skills → Add to project: a real published skill (read-only fetch of one SKILL.md)
  // lands in the project needing review, not enabled.
  await page.getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('radio',{name:'Skills',exact:true}).click();
  await page.route('**/api/plugins/directory*',r=>r.request().url().includes('starters=1')?r.fulfill({json:{items:[]}}):r.fulfill({json:{source:{label:'fixture',home:'https://github.com/anthropics/skills'},items:[{id:'frontend-design',name:'Frontend design',publisher:'Anthropic',description:'',version:'',url:'https://github.com/anthropics/skills',remote:false}]}}));
  await page.getByRole('radio',{name:'MCP servers',exact:true}).click();await page.getByRole('radio',{name:'Skills',exact:true}).click();
  await page.getByRole('button',{name:'Add Frontend design to a project'}).click();
  await page.getByLabel('Project for Frontend design').selectOption({label:'Skill QA'});await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByText(/Added to Skill QA/).waitFor({timeout:20000});
  const after=(await admin(route)).body.skills.find(s=>s.file==='frontend-design/SKILL.md');
  assert.ok(after&&after.valid,`installed skill is valid ${JSON.stringify(after&&after.error)}`);assert.equal(after.status,'review','arrives needing review, not enabled');
  await page.screenshot({path:`${shots}/noevia-skill-add.png`});
  assert.deepEqual(errors,[]);
  console.log('PASS tool scope: a Drive request is offered only Drive and says "Using: Google Drive"; the model can ask once for the rest of the project\'s tools; a matching enabled skill is loaded and labelled, an unrelated message gets only the index; a published skill added from Plugins arrives needing review.');
 }finally{await browser.close();server.kill();model.close();await google.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
