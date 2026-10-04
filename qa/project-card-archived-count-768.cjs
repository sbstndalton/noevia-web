// #768: the project card's chat count leaves out archived chats and shows them on their own
// ("2 chats · 1 archived"). Synthetic projects only (diary-fixture + page.route).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs'),{navClick}=require('./nav.cjs');
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`,browser=await chromium.launch(process.env.QA_CHROME_PATH?{headless:true,executablePath:process.env.QA_CHROME_PATH}:{headless:true,channel:'chrome'}),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const chat=(id,archived)=>({id,title:`Synthetic ${id}`,messages:[],updatedAt:1,...(archived?{archived:true}:{})});
  const base={instructions:'',memories:[],files:[],sourceFolders:[],modes:['chat'],assets:[],toolboxes:[],createdAt:1,updatedAt:1};
  const projects=[
   {...base,id:'onlyArchived',name:'Only archived',goal:'',chats:[chat('a1',true)]},
   {...base,id:'mixed',name:'Mixed chats',goal:'',chats:[chat('m1'),chat('m2'),chat('m3',true)]},
   {...base,id:'live',name:'Live only',goal:'',chats:[chat('l1')]},
  ];
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects,freeChats:[]}}));
  await page.goto(origin);await navClick(page,'Projects');
  const library=page.locator('.projects-workspace');
  const chip=async(name)=>(await library.getByRole('button',{name:`Open project ${name}`,exact:true}).locator('xpath=ancestor::article[1]').locator('.project-chip').allTextContents()).join(' | ');
  await library.getByRole('button',{name:'Open project Mixed chats',exact:true}).waitFor({timeout:10000});
  const only=await chip('Only archived'),mixed=await chip('Mixed chats'),live=await chip('Live only');
  console.log({only,mixed,live});
  assert.match(only,/(^| \| )0 chats · 1 archived( \| |$)/,'only-archived project says 0 chats · 1 archived');
  assert.match(mixed,/(^| \| )2 chats · 1 archived( \| |$)/,'mixed project says 2 chats · 1 archived');
  assert.match(live,/(^| \| )1 chat( \| |$)/,'live project says 1 chat');
  assert.doesNotMatch(live,/archived/);
  const head=await library.getByText(/projects? · \d+ chats?/).first().textContent();
  assert.match(head,/3 projects · 3 chats/,'headline leaves archived chats out');
  assert.deepEqual(errors,[]);
  console.log('PASS project card count: archived chats are excluded and shown separately.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
