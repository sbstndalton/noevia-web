// #519 Planner review in Code mode (features.plannerReview). Synthetic APIs only: no harness, no
// reviewer model. The verdict sits on the final card as advice; the card offers exactly Accept
// change / Decline (no standing allow), sends the card's own id, shows a failed review as
// "Not reviewed" with its reason, and the ordinary tool card keeps all three answers.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const shots=process.env.QA_SCREENSHOTS||'';
const TASK='12345678-1234-4234-8234-123456789012';
const HEAD='b'.repeat(40),BASE='a'.repeat(40);
(async()=>{
 const fixture=createFixture(31379);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [width,height] of [[375,812],[768,1024],[1440,900]])for(const theme of ['light','dark']){
   const page=await browser.newPage(withLocale({viewport:{width,height},isMobile:width<768,hasTouch:width<768}));page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(({theme,material})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:material',material);},{theme,material:process.env.QA_MATERIAL||'soft'});
   const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:1000,updatedAt:1000,modes:['chat']};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...base,id:'p1',name:'Battery notes'}],freeChats:[]}}));
   await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
   await page.route('**/api/features',r=>r.fulfill({json:{flags:{codeHarness:true,plannerReview:true}}}));
   const CAPS=['read_repository','edit_file','execute_command','install_dependency','network','delete','git_push'];
   const task=(over={})=>({id:TASK,status:'waiting_approval',stage:null,error:null,createdAt:1,updatedAt:2,task:'Fix the median bug',branch:'noevia/task-1234',
     meta:null,identityHash:null,capabilities:['read_repository','edit_file'],steps:[],plan:null,assistantOutput:null,approval:null,result:null,...over});
   const verdict={status:'completed',reviewer:'planner',baseSha:BASE,headSha:HEAD,verdict:'request_changes',
     summary:'The even-length case takes one element instead of averaging two. <script>window.reviewHacked=true</script>',
     findings:[{severity:'major',file:'src/median.js',message:'Average the two middle values when the list length is even.'},
       {severity:'note',message:'Consider a test for an empty list.'}],corrected:false};
   const reviewCard=(over={})=>({id:'r1',action:'review_change',title:'Accept this change',kind:'review',command:'',paths:['src/median.js'],
     reason:'The Planner’s verdict is advice. Accepting records this reviewed head as accepted; nothing is merged automatically.',
     arguments:{branch:'noevia/task-1234',baseSha:BASE,headSha:HEAD,files:['src/median.js']},diff:null,review:verdict,...over});
   const toolCard={id:'e1',action:'edit_file',title:'Edit src/median.js',kind:'edit',command:'',paths:['/work/src/median.js'],reason:'',arguments:{path:'/work/src/median.js'},diff:null};
   let tasks=[task({approval:toolCard})];const posts=[];
   await page.route('**/api/projects/p1/code**',async r=>{
     const url=new URL(r.request().url());
     if(url.pathname.endsWith('/approve')){
       const body=r.request().postDataJSON();posts.push([body.approvalId,body.decision]);
       if(body.approvalId==='e1')tasks=[task({review:verdict,approval:reviewCard()})];
       else if(body.approvalId==='r1')tasks=[task({status:'completed',review:verdict,approval:null,
         result:{tools:2,allowed:1,refused:0,denied:0,review:{reviewed:true,verdict:'request_changes',accepted:body.decision==='approve',decision:body.decision,headSha:HEAD}}}),
         task({id:'33333333-3333-4333-8333-333333333333',task:'Unreviewed task',review:{status:'failed',reviewer:'planner',baseSha:BASE,headSha:HEAD,code:'timeout',reason:'The review did not finish within 180 seconds.'},
           approval:reviewCard({id:'r2',review:{status:'failed',reviewer:'planner',baseSha:BASE,headSha:HEAD,code:'timeout',reason:'The review did not finish within 180 seconds.'},
             reason:'Not reviewed: The review did not finish within 180 seconds. Review the change on its branch yourself before accepting it.'})})];
       else if(body.approvalId==='r2')tasks=tasks.map(t=>t.approval?.id==='r2'?{...t,status:'completed',approval:null,
         result:{tools:1,allowed:1,refused:0,denied:0,review:{reviewed:false,verdict:null,accepted:false,decision:'deny',headSha:HEAD}}}:t);
       return r.fulfill({json:{ok:true}});
     }
     return r.fulfill({json:{repositories:[{id:'scratch'}],capabilities:CAPS,defaultCapabilities:['read_repository','edit_file'],
       harnesses:[{id:'opencode',label:'OpenCode',version:'1.18.31'}],promptPreparation:[{id:'direct',label:'Direct',available:true,reason:'Direct'}],
       sandboxed:true,network:false,tasks}});
   });

   await page.goto('http://localhost:31379');await page.getByPlaceholder('Message noevia…').waitFor();
   await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Battery notes'}).first().click();
   await page.getByRole('tab',{name:'Code'}).click();

   // The ordinary tool card is unchanged: three answers.
   await page.getByRole('group',{name:'Approval required'}).waitFor();
   await page.getByRole('button',{name:'Allow for this task'}).waitFor();
   await page.getByRole('button',{name:'Allow once'}).click();

   // The review card: verdict as advice, the exact commits in full, and only the person's answer.
   const card=page.getByRole('group',{name:'Review the finished change'});
   await card.waitFor();
   await card.getByText(/^The Planner requests changes — The even-length case/).waitFor();
   assert.equal(await page.evaluate(()=>window.reviewHacked),undefined,'verdict text stays inert');
   const findings=card.getByRole('list',{name:'Review findings'});
   assert.equal(await findings.locator('li').count(),2);
   assert.ok((await findings.textContent()).includes('Major · src/median.js — Average the two middle values'));
   const args=await card.getByLabel('Change to accept').evaluate(el=>el.textContent);
   assert.ok(args.includes(HEAD)&&args.includes(BASE)&&args.includes('noevia/task-1234'),'the exact head and base are shown in full');
   await card.getByRole('button',{name:'Accept change'}).waitFor();
   await card.getByRole('button',{name:'Decline'}).waitFor();
   assert.equal(await card.getByRole('button',{name:'Allow for this task'}).count(),0,'a review card never offers a standing allow');
   assert.equal(await card.getByRole('button').count(),2);
   await card.getByText('The Planner’s verdict is advice. Only your answer accepts the change, one change at a time.').waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (review card)');
   await card.scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/code-review-card-${width}-${theme}.png`});
   await card.getByRole('button',{name:'Accept change'}).click();

   // Finished: the verdict and the person's answer are both recorded on the task.
   await page.getByText('You accepted this change. Its branch stays in the repository either way.').waitFor();
   const outcome=page.getByRole('region',{name:'Planner review'});
   await outcome.getByText(/^The Planner requests changes/).waitFor();

   // A failed review falls back to the person's own review, and says why.
   const unreviewed=page.getByRole('group',{name:'Review the finished change'});
   await unreviewed.getByText('Not reviewed by the Planner: The review did not finish within 180 seconds.').waitFor();
   await unreviewed.getByText(/^Not reviewed: The review did not finish within 180 seconds\. Review the change on its branch yourself/).waitFor();
   assert.equal(await unreviewed.getByRole('list',{name:'Review findings'}).count(),0);
   await unreviewed.scrollIntoViewIfNeeded();
   if(shots)await page.screenshot({path:`${shots}/code-review-failed-${width}-${theme}.png`});
   await unreviewed.getByRole('button',{name:'Decline'}).click();
   await page.getByText('The change was not accepted. Its branch stays in the repository either way.').waitFor();
   assert.deepEqual(posts,[['e1','approve'],['r1','approve'],['r2','deny']],'each answer names the card it was given on');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow (review outcome)');
   if(shots)await page.screenshot({path:`${shots}/code-review-finished-${width}-${theme}.png`,fullPage:true});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS code-review-519: advisory verdict on the final card, Accept/Decline only, card id sent, failed review says why, tool card keeps three answers; 375/768/1440 light/dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
