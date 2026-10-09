// #1156 / #1157 — Code task cards. A finished task whose change nobody accepted must not read as
// plainly "Finished"; a task the pipeline blocked must say "Blocked" in its header (as its timeline
// does) and, if it never reached the coding agent, say so. Synthetic API only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {navClick}=require('./nav.cjs');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const PORT=Number(process.env.QA_PORT||31380);
const BASE='a'.repeat(40);
(async()=>{
 const fixture=createFixture(PORT);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const failures=[];
 const check=(ok,msg)=>{if(!ok){failures.push(msg);console.log('FAIL',msg);}};
 try{
  const page=await browser.newPage(withLocale({viewport:{width:1440,height:900}}));
  const base={goal:'',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],createdAt:1000,updatedAt:1000,modes:['chat']};
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[{...base,id:'p1',name:'Battery notes'}],freeChats:[]}}));
  await page.route('**/api/projects/*/skills',r=>r.fulfill({json:{skills:[]}}));
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{codeHarness:true,plannerReview:true}}}));
  const task=(over={})=>({id:'t1',status:'completed',stage:null,error:null,createdAt:1,updatedAt:5000,task:'create a python snake game',branch:'noevia/task-1',
   meta:null,identityHash:null,capabilities:['read_repository'],steps:[],plan:null,assistantOutput:null,approval:null,result:null,...over});
  const moves=(...to)=>to.map((t,i)=>({from:i?to[i-1]:null,to:t,revision:0,at:1000+i*10}));
  const tasks=[
   task({id:'a',result:{tools:2,allowed:0,refused:2,denied:0,review:{reviewed:false,verdict:null,accepted:false,decision:'timeout',headSha:null}},
     review:{status:'failed',reviewer:'planner',baseSha:BASE,headSha:null,code:'no_change',reason:'The task made no commits, so there is nothing to review.'}}),
   task({id:'b',task:'Accepted one',result:{tools:3,allowed:3,refused:0,denied:0,review:{reviewed:true,verdict:'approve',accepted:true,decision:'approve',headSha:BASE}}}),
   task({id:'c',task:'Blocked early',status:'failed',error:'No model was pinned for this task: nothing loaded',lifecycle:'blocked',stages:moves('planned','blocked'),pipeline:{maxLoops:2,merge:false,plan:null,evidence:[],audit:null}}),
   task({id:'d',task:'Blocked later',status:'failed',error:'The coding agent made no change.',lifecycle:'blocked',stages:moves('planned','implementing','blocked'),pipeline:{maxLoops:2,merge:false,plan:null,evidence:[],audit:null}}),
   task({id:'e',task:'Plain failure',status:'failed',error:'boom'}),
  ];
  await page.route('**/api/projects/p1/code**',r=>r.fulfill({json:{repositories:[{id:'scratch'}],capabilities:['read_repository'],defaultCapabilities:['read_repository'],
    harnesses:[{id:'opencode',label:'OpenCode',version:'1'}],promptPreparation:[{id:'direct',label:'Direct',available:true,reason:'Direct'}],sandboxed:true,network:false,tasks}}));
  await page.goto(`http://localhost:${PORT}`);await page.getByPlaceholder('Message noevia…').waitFor();
  await navClick(page,'Projects');await page.locator('.project-card').filter({hasText:'Battery notes'}).first().click();
  await page.getByRole('tab',{name:'Code'}).click();
  const card=name=>page.locator('article.code-task').filter({has:page.getByRole('heading',{name,exact:true})});
  const badge=async name=>(await card(name).locator('.code-status').innerText()).trim();
  await card('create a python snake game').waitFor();
  check(await badge('create a python snake game')==='Not accepted',`unaccepted finished task badge: ${await badge('create a python snake game')}`);
  check(/not accepted/i.test(await card('create a python snake game').locator('.code-stage').innerText()),'unaccepted outcome line says so');
  check(await badge('Accepted one')==='Finished','an accepted task still says Finished');
  check(await badge('Blocked early')==='Blocked',`blocked header: ${await badge('Blocked early')}`);
  check(/before the coding agent started/i.test(await card('Blocked early').locator('.code-stage').innerText()),'blocked-before-start outcome line');
  check(await badge('Blocked later')==='Blocked','blocked later header');
  check(!/before the coding agent started/i.test(await card('Blocked later').locator('.code-stage').innerText()),'a later block does not claim it never started');
  check(await badge('Plain failure')==='Failed','a plain failure stays Failed');
 }finally{await browser.close();await fixture.close?.();}
 if(failures.length)process.exitCode=1;else console.log('PASS code-task-badges-1156-1157');
})().catch(e=>{console.error(e);process.exitCode=1;});
