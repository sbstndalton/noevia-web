// Code mode tab for admins with features.codeHarness (spec-agent-execution §3). Synthetic APIs
// only: no harness, no repository, no subprocess. Checks the gate above all — three answers,
// arguments in full — and that deletes and pushes never offer a standing allow.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const shots=process.env.QA_SCREENSHOTS||'';
const TASK='12345678-1234-4234-8234-123456789012';
(async()=>{
 const fixture=createFixture(31377);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,height] of [[375,812],[768,1024],[1440,900]])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:width<768});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:1000,updatedAt:1000,modes:['chat']};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...base,id:'p1',name:'Battery notes'}],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   let flags={codeHarness:false};
   await page.route('**/api/features',r=>r.fulfill({json:{flags}}));

   const CAPS=['read_repository','edit_file','execute_command','install_dependency','network','delete','git_push'];
   const posts=[];let tasks=[];
   // The long, untruncated arguments the card must show in full.
   const longCommand='npm run build -- --target=production --flag='+('x'.repeat(300));
   const approval=(over={})=>({id:'a1',action:'edit_file',title:'Edit src/median.js',kind:'edit',command:'',paths:['/work/src/median.js'],
     reason:'',arguments:{path:'/work/src/median.js',content:'export function median(list) { /* '+('long '.repeat(80))+'*/ }'},diff:null,...over});
   const task=(over={})=>({id:TASK,status:'running',stage:'Reading the repository',error:null,createdAt:1,updatedAt:2,
     task:'Fix the median bug',branch:'noevia/task-1234',
     capabilities:['read_repository','edit_file','execute_command'],steps:[],plan:null,approval:null,result:null,...over});
   await page.route('**/api/projects/p1/code**',async r=>{
     const url=new URL(r.request().url()),method=r.request().method();
     if(url.pathname.endsWith('/approve')){
       const body=r.request().postDataJSON();posts.push(['decide',body.decision]);
       // After an edit is allowed, the harness asks to delete: a class that never stands.
       tasks=[task({status:'waiting_approval',approval:approval({id:'a2',action:'delete',title:'Delete build/',kind:'delete',paths:['/work/build'],arguments:{path:'/work/build'}})})];
       if(body.decision==='deny')tasks=[task({status:'waiting_approval',approval:approval({id:'a3',action:'execute_command',title:'Run the tests',kind:'execute',command:longCommand,arguments:{command:longCommand}})})];
       return r.fulfill({json:{ok:true}});
     }
     if(url.pathname.endsWith('/cancel')){tasks=[task({status:'cancelled',stage:null,approval:null,result:{branch:'noevia/task-1234',tools:4,approvals:2,allowed:1,refused:1,denied:0}})];return r.fulfill({json:tasks[0]});}
     if(method==='POST'){posts.push(['start',r.request().postDataJSON()]);tasks=[task({status:'waiting_approval',approval:approval()})];return r.fulfill({status:202,json:{taskId:TASK,branch:'noevia/task-1234'}});}
     return r.fulfill({json:{repositories:[{id:'noevia'},{id:'scratch'}],capabilities:CAPS,defaultCapabilities:['read_repository','edit_file','execute_command'],tasks}});
   });

   await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
   await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Battery notes'}).first().click();
   await page.getByRole('tab',{name:/Chats/}).waitFor();
   assert.equal(await page.getByRole('tab',{name:'Code'}).count(),0,'Code tab shown with the feature off');
   flags={codeHarness:true};
   await page.evaluate(()=>window.dispatchEvent(new Event('noevia:features-changed')));
   await page.getByRole('tab',{name:'Code'}).click();

   // Domains only appear once a capability needs them.
   assert.equal(await page.getByLabel('Domains it may reach').count(),0,'domains asked for without a network capability');
   await page.getByLabel('Install dependencies').check();
   await page.getByLabel('Domains it may reach').fill('registry.npmjs.org, not a domain');
   await page.getByLabel('Repository',{exact:true}).selectOption('scratch');
   await page.getByLabel('What should it do?').fill('Fix the median bug');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (compose)');
   if(shots)await page.screenshot({path:`${shots}/code-compose-${width}-${theme}.png`,fullPage:true});
   await page.getByRole('button',{name:'Start task'}).click();
   assert.deepEqual(posts.at(-1),['start',{repository:'scratch',prompt:'Fix the median bug',
     capabilities:['read_repository','edit_file','execute_command','install_dependency'],domains:['registry.npmjs.org','not a domain']}]);

   // The gate: three answers, arguments in full.
   await page.getByRole('heading',{name:'Fix the median bug'}).waitFor();
   await page.getByRole('group',{name:'Approval required'}).waitFor();
   await page.getByRole('button',{name:'Allow once'}).waitFor();
   await page.getByRole('button',{name:'Decline'}).waitFor();
   await page.getByRole('button',{name:'Allow for this task'}).waitFor();
   // textContent, not innerText: a soft wrap must not be mistaken for the text itself.
   const shown=await page.getByLabel('Arguments').evaluate(el=>el.textContent);
   assert.ok(shown.includes('long '.repeat(80).trim()),'the arguments were truncated');
   assert.equal(await page.getByRole('button',{name:'Start task'}).isDisabled(),true,'a second task while one runs');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (approval)');
   // The panel scrolls inside the project pane, so fullPage alone would photograph the
   // composer and never the card. Bring the card into view first.
   await page.getByRole('group',{name:'Approval required'}).scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/code-approval-${width}-${theme}.png`});

   await page.getByRole('button',{name:'Allow once'}).click();
   // A delete is next: it must not offer a standing allow.
   await page.getByText('Delete files — Delete build/').waitFor();
   assert.equal(await page.getByRole('button',{name:'Allow for this task'}).count(),0,'a delete offered a standing allow');
   await page.getByText('Deletes and pushes are asked every time.').waitFor();
   await page.getByRole('group',{name:'Approval required'}).scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/code-delete-${width}-${theme}.png`});

   await page.getByRole('button',{name:'Decline'}).click();
   // Wait for the card we expect, not merely for an element to exist: the previous card is
   // still on screen (with its buttons disabled) until the next poll lands.
   await page.getByText('Run commands — Run the tests').waitFor();
   // textContent, not innerText: a soft wrap must not be mistaken for the text itself.
   const cmd=await page.getByLabel('Command',{exact:true}).evaluate(el=>el.textContent);
   assert.ok(cmd.includes('x'.repeat(300)),'the command was truncated');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (long command)');
   await page.getByRole('button',{name:'Cancel task'}).click();
   await page.getByText('4 tool calls · 1 allowed · 1 declined · 0 refused by noevia').waitFor();
   assert.deepEqual(posts.map(p=>p[1]).slice(1),['approve','deny']);
   await page.getByText('4 tool calls · 1 allowed · 1 declined · 0 refused by noevia').scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/code-finished-${width}-${theme}.png`});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS code-mode: tab hidden until the feature, repository/capability/domain choices, three approval answers with untruncated arguments, no standing allow for deletes, long commands shown whole, cancel; 375/768/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
