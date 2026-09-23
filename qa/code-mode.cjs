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
   await page.addInitScript(({theme,material})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:material',material);},{theme,material:process.env.QA_MATERIAL||'soft'});
   const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:1000,updatedAt:1000,modes:['chat']};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...base,id:'p1',name:'Battery notes'},{...base,id:'p2',name:'Field notes'}],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   let flags={codeHarness:false};
   await page.route('**/api/features',r=>r.fulfill({json:{flags}}));

   const CAPS=['read_repository','edit_file','execute_command','install_dependency','network','delete','git_push'];
   const posts=[];let tasks=[];let online=false;
   // The long, untruncated arguments the card must show in full.
   const longCommand='npm run build -- --target=production --flag='+('x'.repeat(300));
   const approval=(over={})=>({id:'a1',action:'edit_file',title:'Edit src/median.js',kind:'edit',command:'',paths:['/work/src/median.js'],
     reason:'',arguments:{path:'/work/src/median.js',content:'export function median(list) { /* '+('long '.repeat(80))+'*/ }'},diff:null,...over});
   const task=(over={})=>({id:TASK,status:'running',stage:'Reading the repository',error:null,createdAt:1,updatedAt:2,
     task:'Fix the median bug',branch:'noevia/task-1234',meta:null,identityHash:null,
     capabilities:['read_repository','edit_file','execute_command'],steps:[],plan:null,assistantOutput:null,approval:null,result:null,...over});
   const visible='I checked the path.\n/work/'+('longfilename'.repeat(40))+'\n'+('A line\n'.repeat(80))+'<script>window.hacked=true</script>';
   await page.route('**/api/projects/p2/code**',r=>r.fulfill({json:{repositories:[{id:'noevia'}],capabilities:CAPS,
     defaultCapabilities:['read_repository'],harnesses:[{id:'opencode',label:'OpenCode',version:null}],
     promptPreparation:[{id:'direct',label:'Direct',available:true,reason:'Direct'}],sandboxed:true,network:false,
     tasks:[task({id:'22222222-2222-4222-8222-222222222222',task:'Field task',status:'completed',
       assistantOutput:{text:'Only the field project sees this.',truncated:false}})]}}));
   await page.route('**/api/projects/p1/code**',async r=>{
     const url=new URL(r.request().url()),method=r.request().method();
     if(url.pathname.endsWith('/approve')){
       const body=r.request().postDataJSON();posts.push(['decide',body.decision]);
       // After an edit is allowed, the harness asks to delete: a class that never stands.
       tasks=[task({status:'waiting_approval',assistantOutput:{text:visible,truncated:false},approval:approval({id:'a2',action:'delete',title:'Delete build/',kind:'delete',paths:['/work/build'],arguments:{path:'/work/build'}})})];
       if(body.decision==='deny')tasks=[task({status:'waiting_approval',assistantOutput:{text:visible,truncated:false},approval:approval({id:'a3',action:'execute_command',title:'Run the tests',kind:'execute',command:longCommand,arguments:{command:longCommand}})})];
       return r.fulfill({json:{ok:true}});
     }
     if(url.pathname.endsWith('/cancel')){tasks=[task({status:'cancelled',stage:null,approval:null,assistantOutput:{text:visible,truncated:false},
       result:{branch:'noevia/task-1234',tools:4,approvals:2,allowed:1,refused:1,denied:0,
         network:{allowed:3,refused:2,hosts:[{host:'github.com',allowed:0,refused:2,reason:'host is not on this task’s list'},{host:'pypi.org',allowed:3,refused:0,reason:null}]}},
       // A harness that reported some of itself and not the rest: both halves must show.
       meta:{harness:'opencode',harnessVersion:'1.18.31',protocolVersion:1,usage:null,context:{used:8012,size:24576,percent:33},commands:2,failedCommands:1,messageChunks:3,
         limitations:['The harness did not report token usage.']},identityHash:'a'.repeat(64)})];return r.fulfill({json:tasks[0]});}
     if(method==='POST'){posts.push(['start',r.request().postDataJSON()]);tasks=[task({status:'waiting_approval',assistantOutput:{text:'First visible words.',truncated:false},approval:approval()})];return r.fulfill({status:202,json:{taskId:TASK,branch:'noevia/task-1234'}});}
     return r.fulfill({json:{repositories:[{id:'noevia'},{id:'scratch'}],capabilities:CAPS,
       defaultCapabilities:['read_repository','edit_file','execute_command'],
       harnesses:[{id:'opencode',label:'OpenCode',version:'1.18.31'}],
       promptPreparation:[{id:'direct',label:'Direct',available:true,reason:'Your request goes to the model as you wrote it.'},
         {id:'local',label:'Local architect',available:false,reason:'Not offered yet: as an architect the 4B returned 0 of 18 usable execution prompts.'}],
       sandboxed:true,network:online,tasks}});
   });

   await page.goto('http://localhost:31377');await page.getByPlaceholder('Message noevia…').waitFor();
   await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Battery notes'}).first().click();
   await page.getByRole('tab',{name:/Chats/}).waitFor();
   assert.equal(await page.getByRole('tab',{name:'Code'}).count(),0,'Code tab shown with the feature off');
   flags={codeHarness:true};
   await page.evaluate(()=>window.dispatchEvent(new Event('noevia:features-changed')));
   await page.getByRole('tab',{name:'Code'}).click();

   // The Code tab has its own way to start something; the chat composer is not left underneath.
   await page.getByText('OpenCode 1.18.31').waitFor();
   assert.equal(await page.getByRole('textbox',{name:'Message Battery notes'}).isVisible(),false,'a chat composer under the Code tab');
   // Without the egress proxy, network and installs are shown unavailable, with the reason, and
   // never sent: offering them would promise a network the task will not get.
   assert.ok(await page.getByLabel('Reach the network').isDisabled());
   assert.ok(await page.getByLabel('Install dependencies').isDisabled());
   await page.getByText(/need the egress proxy, which this server does not run/).waitFor();
   await page.getByText('The harness runs in the sandbox container: no credentials, and no network at all.').waitFor();
   assert.equal(await page.getByLabel('Domains it may reach').count(),0);
   // With the proxy, they are offered; switching tabs reloads what the server says.
   online=true;
   await page.getByRole('tab',{name:/Chats/}).click();await page.getByRole('tab',{name:'Code'}).click();

   // One harness: stated as the fact it is, not a dropdown pretending to offer a choice.
   await page.getByText('OpenCode 1.18.31').waitFor();
   assert.equal(await page.getByRole('combobox',{name:'Harness'}).count(),0,'a one-option dropdown is a lie about choice');
   await page.getByText(/The harness runs in the sandbox container/).waitFor();
   // Prompt preparation offers Direct; a mode without evidence is present but not selectable.
   const prep=page.getByLabel('Prompt preparation');
   assert.deepEqual(await prep.locator('option').evaluateAll(os=>os.map(o=>[o.textContent,o.disabled])),
     [['Direct',false],['Local architect — not available',true]]);
   await page.getByText('Your request goes to the model as you wrote it.').waitFor();
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
     capabilities:['read_repository','edit_file','execute_command','install_dependency'],
     harness:'opencode',promptPreparation:'direct',domains:['registry.npmjs.org','not a domain']}]);

   // The gate: three answers, arguments in full.
   await page.getByRole('heading',{name:'Fix the median bug'}).waitFor();
   await page.getByRole('group',{name:'Approval required'}).waitFor();
   assert.equal(await page.getByRole('region',{name:'Assistant output'}).textContent(), 'Assistant outputFirst visible words.');
   assert.ok(await page.getByRole('group',{name:'Approval required'}).evaluate((el)=>
     el.compareDocumentPosition(document.querySelector('.code-output')) & Node.DOCUMENT_POSITION_FOLLOWING), 'approval before output');
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
   const output=page.getByRole('region',{name:'Assistant output'});
   assert.ok((await output.textContent()).includes(visible));
   assert.equal(await page.evaluate(()=>window.hacked),undefined,'assistant text stays inert');
   assert.ok(await output.evaluate(el=>el.scrollHeight>el.clientHeight),'long output scrolls within its region');
   await page.getByRole('button',{name:'Cancel task'}).focus();await page.keyboard.press('Tab');
   assert.equal(await output.evaluate(el=>el===document.activeElement),true,'output follows the action in keyboard order');
   assert.equal(await output.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle!=='none'),true,'keyboard focus is visible');
   const beforeScroll=await output.evaluate(el=>el.scrollTop);
   await page.keyboard.press('PageDown');await page.waitForTimeout(150);
   assert.ok(await output.evaluate(el=>el.scrollTop)>beforeScroll,'keyboard scrolls the bounded output region');
   if(shots)await page.screenshot({path:`${shots}/code-output-focused-${width}-${theme}.png`});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (assistant output)');
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
   assert.ok((await page.getByRole('region',{name:'Assistant output'}).textContent()).includes('I checked the path.'));
   await page.getByRole('region',{name:'Assistant output'}).scrollIntoViewIfNeeded();
   await page.getByRole('region',{name:'Assistant output'}).evaluate(el=>{el.scrollTop=0;});
   if(shots)await page.screenshot({path:`${shots}/code-output-completed-${width}-${theme}.png`});
   // Where it went through the egress proxy, and where it was refused (by name, so the next task can ask).
   await page.getByText('Reached pypi.org (3)').waitFor();
   await page.getByText(/^Refused github\.com \(2\)\. A task reaches only the domains it names/).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (network note)');
   // What it reported, and — just as visibly — what it did not.
   await page.getByText('opencode 1.18.31 · context 33% of 24,576 · 2 commands, 1 failed').waitFor();
   await page.getByText('Not reported by this harness (1)').click();
   await page.getByText('The harness did not report token usage.').waitFor();
   assert.deepEqual(posts.map(p=>p[1]).slice(1),['approve','deny']);
   await page.getByText('4 tool calls · 1 allowed · 1 declined · 0 refused by noevia').scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/code-finished-${width}-${theme}.png`});
   tasks=[task({id:'f',task:'Failed task',status:'failed',error:'Synthetic failure',assistantOutput:{text:'Partial before failure.',truncated:false}}),
     task({id:'i',task:'Interrupted task',status:'interrupted',assistantOutput:{text:'Flushed before restart.',truncated:false}}),
     task({id:'t',task:'Truncated task',status:'completed',assistantOutput:{text:'x'.repeat(32768),truncated:true}}),
     task({id:'n',task:'Silent task',status:'completed',assistantOutput:null})];
   await page.getByRole('tab',{name:/Chats/}).click();await page.getByRole('tab',{name:'Code'}).click();
   await page.getByText('Partial before failure.').waitFor();
   await page.getByText('Flushed before restart.').waitFor();
   await page.getByText('Showing the first 32 KiB of output.').waitFor();
   assert.equal(await page.getByRole('region',{name:'Assistant output'}).count(),3,'null output has no section');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (32KiB output)');
   await page.getByText('Showing the first 32 KiB of output.').scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/code-truncated-${width}-${theme}.png`});
   await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Field notes'}).first().click();
   await page.getByRole('tab',{name:'Code'}).click();
   await page.getByText('Only the field project sees this.').waitFor();
   assert.equal(await page.getByText('Partial before failure.').count(),0,'another project cannot see task output');
   await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Battery notes'}).first().click();
   await page.getByRole('tab',{name:'Code'}).click();
   await page.getByText('Partial before failure.').waitFor();
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS code-mode: repository and approval gates, bounded assistant output with keyboard scroll, terminal/null/truncated states, project revisit; 375/768/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
