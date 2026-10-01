// #706 Code pipeline UI (features.codePipeline). Synthetic APIs only: no harness, no model. Pipeline
// tasks (implementing r1, changes_requested -> r2, reviewing with the accept card merge on and off,
// blocked, merged) show a stage strip, the current revision's evidence, and collapsible sections;
// the test tail is untrusted text; an ordinary task shows none of it.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const shots=process.env.QA_SCREENSHOTS||'';
const id=n=>`12345678-1234-4234-8234-12345678900${n}`;
const BASE='a'.repeat(40),H1='b1'.repeat(20),H2='c2'.repeat(20),PH='d4'.repeat(32);
// A fixed "now": every timestamp below is relative to it, so the page reads as it would live.
const NOW=Date.parse('2026-10-01T09:00:00Z'),T0=NOW-2*3600e3,TM=NOW-(2*86400e3+4*3600e3);
(async()=>{
 const fixture=createFixture(31389);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,height] of [[375,812],[1440,900]])for(const theme of ['light','dark']){
   const page=await browser.newPage(withLocale({viewport:{width,height},isMobile:width<768,hasTouch:width<768}));page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(({theme,material})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:material',material);},{theme,material:process.env.QA_MATERIAL||'soft'});
   const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:NOW-30*86400e3,updatedAt:NOW-3600e3,modes:['chat']};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...base,id:'p1',name:'Battery notes'}],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   await page.route('**/api/features',r=>r.fulfill({json:{flags:{codeHarness:true,codePipeline:true}}}));
   const CAPS=['read_repository','edit_file','execute_command','install_dependency','network','delete','git_push'];
   const task=(n,title,over={})=>({id:id(n),status:'running',stage:null,error:null,createdAt:T0,updatedAt:T0+60000,task:title,branch:`noevia/task-${n}`,
     meta:null,identityHash:null,capabilities:['read_repository','edit_file'],steps:[],plan:null,assistantOutput:null,approval:null,result:null,...over});
   const mv=(from,to,revision,at,reason='ok',b=T0)=>({from,to,revision,reason,at:b+at});
   const tests=(passed,tail)=>({passed,exitCode:passed?0:1,signal:null,timedOut:false,headSha:passed?H2:H1,durationMs:4200,tail,truncated:!passed});
   const plan={revision:1,planHash:PH,plan:{goal:'Make median() average the middle pair',steps:[{n:1,do:'Fix the even-length branch in src/median.js',done_when:'median([1,2,3,4]) is 2.5'},{n:2,do:'Add a regression test',done_when:'npm test passes'}],constraints:['Do not change the public signature']}};
   const passAll=[{name:'revision-bound',status:'pass',detail:'Evidence is for r2'},{name:'plan-recorded',status:'pass',detail:'Plan on record'},{name:'tests-measured',status:'pass',detail:'Measured by the verifier'},
     {name:'completeness-gate',status:'pass',detail:'Plan and test report present'},{name:'review-bound',status:'pass',detail:'Verdict is for this commit'},{name:'head-unchanged',status:'pass',detail:'Branch has not moved'},{name:'nothing-unresolved',status:'pass',detail:'No open findings recorded'}];
   const checks=passAll.map(c=>c.name==='nothing-unresolved'?{...c,status:'unknown'}:c);
   const audit={revision:2,headSha:H2,overall:'complete',checks:passAll,evidence:{},writeUp:{completeness:'complete',summary:'Both plan steps are covered by the tests.',evidence:[{source:'test-report',note:'12 passed'}],gaps:['No test for an empty list']}};
   const ev1={revision:1,headSha:H1,baseSha:BASE,planHash:PH,tests:tests(false,'FAIL median.test.js\n<img src=x onerror="window.pwned=1">\n  expected 2.5 received 2'),
     review:{verdict:'request_changes',summary:'Even-length case is still wrong.',findings:[{severity:'major',message:'Average two values'}],headSha:H1},completeness:{reportHash:'e'.repeat(64)}};
   const ev2={revision:2,headSha:H2,baseSha:BASE,planHash:PH,tests:tests(true,'ok 12 tests passed'),review:{verdict:'approve',summary:'Looks right.',findings:[],headSha:H2},completeness:{reportHash:'f'.repeat(64)}};
   const pipe=(over={})=>({maxLoops:2,merge:true,plan,evidence:[],audit:null,...over});
   const incompleteAudit={...audit,overall:'incomplete',checks};
   const accept=(mode)=>{const merge=mode==='merge',cks=mode==='incomplete'?checks:passAll;return {id:'a1',action:'review_change',title:'Accept this change',kind:'review',command:'',paths:['src/median.js'],reason:'Accepting is your decision.',
     arguments:{branch:'noevia/task-3',baseSha:BASE,headSha:H2,files:['src/median.js'],revision:2,mergeInto:merge?'main':null},diff:null,
     verdict:{verdict:'approve',summary:'Looks right.',findings:0},audit:{overall:mode==='incomplete'?'incomplete':'complete',checks:cks.map(c=>({name:c.name,status:c.status})),writeUp:{completeness:'complete',summary:'Both plan steps are covered by the tests.'}},
     evidence:{revision:2,headSha:H2,planHash:PH,tests:tests(true,'ok'),completeness:{reportHash:'f'.repeat(64)}},merge:merge?{into:'main',from:BASE,to:H2}:null,
     mergeWithheld:mode==='incomplete'?{code:'audit_incomplete',reason:'Merging is not offered because the audit is incomplete (nothing-unresolved: No open findings recorded)'}:null};};
   const LONG=2*86400e3+3*3600e3;
   const tasks=[
    task(1,'Pipeline implementing',{lifecycle:'implementing',revision:{n:1,headSha:null,planHash:PH,at:T0+20000},stages:[mv(null,'planned',1,0),mv('planned','implementing',1,20000)],pipeline:pipe()}),
    task(2,'Pipeline looped',{lifecycle:'implementing',revision:{n:2,headSha:null,planHash:PH,at:T0+90000},updatedAt:T0+100000,
      stages:[mv(null,'planned',1,0),mv('planned','implementing',1,10000),mv('implementing','verifying',1,40000),mv('verifying','changes_requested',1,50000),mv('changes_requested','implementing',2,60000)],pipeline:pipe({evidence:[ev1]})}),
    task(3,'Pipeline accept merge on',{status:'waiting_approval',lifecycle:'reviewing',revision:{n:2,headSha:H2,planHash:PH,at:T0+90000},updatedAt:T0+200000,approval:accept('merge'),
      stages:[mv(null,'planned',1,0),mv('planned','implementing',1,10000),mv('implementing','verifying',1,40000),mv('verifying','changes_requested',1,50000),mv('changes_requested','implementing',2,60000),mv('implementing','verifying',2,120000),mv('verifying','reviewing',2,150000)],pipeline:pipe({evidence:[ev1,ev2],audit})}),
    task(4,'Pipeline accept merge off',{status:'waiting_approval',lifecycle:'reviewing',revision:{n:2,headSha:H2,planHash:PH,at:T0+90000},updatedAt:T0+200000,approval:accept('off'),
      stages:[mv(null,'planned',1,0),mv('planned','implementing',1,10000),mv('implementing','verifying',1,40000),mv('verifying','reviewing',1,150000)],pipeline:pipe({merge:false,evidence:[ev1,ev2],audit})}),
    task(8,'Pipeline accept audit incomplete',{status:'waiting_approval',lifecycle:'reviewing',revision:{n:2,headSha:H2,planHash:PH,at:T0+90000},updatedAt:T0+200000,approval:accept('incomplete'),
      stages:[mv(null,'planned',1,0),mv('planned','implementing',1,10000),mv('implementing','verifying',1,40000),mv('verifying','reviewing',1,150000)],pipeline:pipe({evidence:[ev1,ev2],audit:incompleteAudit})}),
    task(5,'Pipeline blocked',{status:'failed',error:'Blocked: the verifier was unavailable',lifecycle:'blocked',revision:{n:1,headSha:H1,planHash:PH,at:T0+20000},updatedAt:T0+70000,
      stages:[mv(null,'planned',1,0),mv('planned','implementing',1,20000),mv('implementing','verifying',1,50000),mv('verifying','blocked',1,70000,'verify unavailable')],pipeline:pipe({evidence:[{...ev1,tests:null,review:null}]})}),
    task(6,'Pipeline merged',{status:'completed',lifecycle:'merged',createdAt:TM,revision:{n:2,headSha:H2,planHash:PH,at:TM+90000},updatedAt:TM+LONG+120000,
      stages:[mv(null,'planned',1,0,'ok',TM),mv('planned','implementing',1,10000,'ok',TM),mv('implementing','verifying',1,40000,'ok',TM),mv('verifying','reviewing',1,50000,'ok',TM),mv('reviewing','merged',2,50000+LONG,'ok',TM)],pipeline:pipe({evidence:[ev1,ev2],audit}),
      result:{pipeline:true,revision:2,merged:true,mergedInto:'main',accepted:true}}),
    task(7,'Ordinary task',{status:'completed',result:{tools:3}}),
   ];
   const active=()=>tasks.filter(t=>t.status==='waiting_approval'||t.status==='running').map(t=>({id:t.id,projectId:'p1',projectName:'Battery notes',title:t.task,status:t.status,stage:t.lifecycle||null,updatedAt:t.updatedAt,approvalAction:t.approval?.action||null}));
   await page.route('**/api/code/active',r=>r.fulfill({json:{tasks:active(),total:active().length}}));
   await page.clock.setFixedTime(NOW);
   await page.route('**/api/projects/p1/code**',r=>r.fulfill({json:{repositories:[{id:'scratch'}],capabilities:CAPS,defaultCapabilities:['read_repository','edit_file'],
     harnesses:[{id:'opencode',label:'OpenCode',version:'1.18.31'}],promptPreparation:[{id:'direct',label:'Direct',available:true,reason:'Direct'}],sandboxed:true,network:false,tasks}}));
   await page.goto('http://localhost:31389');await page.getByPlaceholder('Message noevia…').waitFor();
   await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Battery notes'}).first().click();
   await page.getByRole('tab',{name:'Code'}).click();
   const card=title=>page.locator('article.code-task').filter({has:page.getByRole('heading',{name:title})});

   // implementing r1: strip with the current stage marked, the revision, durations.
   const c1=card('Pipeline implementing');await c1.waitFor();
   const strip=c1.getByRole('list',{name:'Pipeline stages'});
   assert.equal(await strip.locator('li').count(),6);
   assert.equal(await strip.locator('li[aria-current="step"]').count(),1);
   assert.ok((await strip.locator('li[aria-current="step"]').textContent()).startsWith('Implementing'));
   assert.match(await strip.locator('li').first().textContent(),/20\s?(s|sec)/,'planned lasted 20 seconds');
   await c1.getByText('Revision r1',{exact:true}).waitFor({state:'attached'});
   await c1.getByText('No evidence has been recorded for this revision yet.').waitFor();

   // changes_requested -> r2: the loop shows r2, earlier revision r1 behind a disclosure.
   const c2=card('Pipeline looped');
   assert.ok((await c2.locator('.code-pipe-rev').textContent()).includes('r2'));
   const earlier=c2.locator('details',{hasText:'Earlier revisions'});
   await earlier.locator('summary').first().click();
   assert.ok((await earlier.textContent()).includes('Failed'),'r1 tests failed');
   await earlier.locator('details',{hasText:'Test output'}).locator('summary').click();
   assert.ok((await earlier.locator('pre').textContent()).includes('<img src=x onerror="window.pwned=1">'),'the tail is shown as text');
   assert.equal(await earlier.locator('pre img').count(),0,'the tail is never markup');
   assert.equal(await page.evaluate(()=>window.pwned),undefined);
   assert.ok((await c2.getByRole('list',{name:'Pipeline stages'}).locator('li').nth(4).textContent()).includes('Changes requested'));

   // reviewing + accept card, merge on.
   const c3=card('Pipeline accept merge on');
   const ev=c3.getByRole('region',{name:'Evidence for revision r2'});await ev.waitFor();
   assert.ok((await ev.textContent()).includes('c2c2c2c'),'short head sha');
   assert.ok(!(await ev.textContent()).includes(H2),'only the short sha is printed');
   await ev.getByText('Passed',{exact:true}).waitFor();
   await ev.getByRole('list',{name:'Completeness checks'}).waitFor();
   await c3.locator('details',{hasText:'Planner plan'}).locator('summary').click();
   await c3.getByText('Done when: median([1,2,3,4]) is 2.5').waitFor();
   await c3.locator('details',{hasText:'Auditor report'}).locator('summary').click();
   await c3.getByText('No test for an empty list').waitFor();
   const ac=c3.getByRole('group',{name:'Review the finished change'});
   const acText=await ac.innerText();
   assert.ok(!acText.includes('mergeInto')&&!acText.includes('"headSha"'),'no raw JSON on the card');
   assert.ok(acText.includes('noevia/task-3')&&acText.includes('main')&&acText.includes('c2c2c2c'),'branch, base and reviewed commit in words');
   await ac.locator('summary',{hasText:'Details'}).click();
   assert.ok((await ac.locator('pre').textContent()).includes('"mergeInto": "main"'),'raw payload stays behind Details');
   await ac.getByRole('button',{name:'Merge into main'}).waitFor();
   assert.equal(await ac.getByRole('button',{name:'Accept without merging'}).count(),0);
   assert.equal(await ac.getByRole('button').count(),2,'accept and decline only');
   await ac.getByText(/Both plan steps are covered/).first().waitFor();
   // merge off.
   const c4=card('Pipeline accept merge off');
   await c4.getByRole('button',{name:'Accept without merging'}).waitFor();
   assert.equal(await c4.getByRole('button',{name:/Merge into/}).count(),0);
   // blocked: red stage, current.
   // The audit is incomplete: accept-only, the reasons listed, no merge offered.
   const c8=card('Pipeline accept audit incomplete');
   await c8.getByRole('button',{name:'Accept without merging'}).waitFor();
   assert.equal(await c8.getByRole('button',{name:/Merge into/}).count(),0);
   const why=c8.getByRole('group',{name:'Why merging is not offered'});await why.waitFor();
   assert.ok((await why.innerText()).includes('Nothing unresolved'),'the open check is the reason');
   const c5=card('Pipeline blocked');
   const blocked=c5.getByRole('list',{name:'Pipeline stages'}).locator('li.is-blocked');
   assert.equal(await blocked.count(),1);assert.ok((await blocked.textContent()).startsWith('Blocked'));
   assert.equal(await blocked.getAttribute('aria-current'),'step');
   await c5.getByText('Blocked: the verifier was unavailable').waitFor();
   // merged.
   const c6=card('Pipeline merged');
   assert.ok((await c6.getByRole('list',{name:'Pipeline stages'}).locator('li[aria-current="step"]').textContent()).startsWith('Merged'));
   // ordinary task: nothing new.
   const c7=card('Ordinary task');await c7.waitFor();
   assert.equal(await c7.locator('.code-pipe, .code-pipe-details-wrap').count(),0);
   // Humane durations: days and hours, never thousands of minutes.
   const longStrip=await c6.getByRole('list',{name:'Pipeline stages'}).innerText();
   assert.ok(/2 days, 3 hrs|2d 3h/.test(longStrip),'long stage rolls up to days and hours: '+longStrip);
   assert.ok(!/\d{3,}m/.test(await page.locator('.code-stage').first().innerText()),'no huge minute counts');
   assert.equal(await page.getByText('Code task status unavailable').count(),0,'no status banner');
   // keyboard: summaries are reachable and toggle with Enter.
   const sum=c6.locator('summary',{hasText:'Planner plan'});await sum.focus();await page.keyboard.press('Enter');
   assert.equal(await c6.locator('details',{hasText:'Planner plan'}).evaluate(d=>d.open),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
   if(shots){await ac.locator('summary',{hasText:'Details'}).click();await c3.scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/pipeline-review-${width}-${theme}.png`,fullPage:true});
     await c1.scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/pipeline-top-${width}-${theme}.png`});}
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS code-pipeline-706: stage strip, revision, durations, evidence, text-only tail, plan/audit/earlier sections, accept card merge on/off, blocked, merged, ordinary task unchanged; 375/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
