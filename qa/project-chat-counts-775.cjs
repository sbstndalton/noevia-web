// #775: the project header and the sidebar hover card count chats the same way as the project
// card (#768): archived chats are left out, and the header names them on their own.
// Synthetic projects only (diary-fixture + page.route).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`,browser=await chromium.launch(process.env.QA_CHROME_PATH?{headless:true,executablePath:process.env.QA_CHROME_PATH}:{headless:true,channel:'chrome'}),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  const chat=(id,archived)=>({id,title:`Synthetic ${id}`,messages:[],updatedAt:1,...(archived?{archived:true}:{})});
  const base={instructions:'',memories:[],files:[],sourceFolders:[],modes:['chat'],assets:[],toolboxes:[],createdAt:1,updatedAt:1};
  const projects=[
   {...base,id:'mixed',name:'Mixed chats',goal:'',chats:[chat('m1'),chat('m2'),chat('m3',true)]},
   {...base,id:'live',name:'Live only',goal:'',chats:[chat('l1')]},
  ];
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects,freeChats:[]}}));
  await page.goto(origin);
  const row=page.getByRole('button',{name:'Open Mixed chats',exact:true});
  await row.waitFor({timeout:10000});
  await row.hover();
  const card=page.locator('.row-card');await card.waitFor({timeout:5000});
  const sidebar=(await card.locator('span').first().textContent()).trim();
  console.log({sidebar});
  assert.match(sidebar,/^2 chats · 0 sources$/,'sidebar hover card leaves archived chats out');
  await row.click();
  const meta=page.locator('.project-detail-meta');await meta.waitFor({timeout:10000});
  const header=(await meta.textContent()).trim();
  console.log({header});
  assert.match(header,/^2 chats · 1 archived · /,'project header says 2 chats · 1 archived');
  await page.getByRole('button',{name:'Open Live only',exact:true}).click();
  await page.locator('.project-detail-meta',{hasText:/^1 chat · /}).waitFor({timeout:10000});
  assert.doesNotMatch(await page.locator('.project-detail-meta').textContent(),/archived/);
  assert.deepEqual(errors,[]);
  console.log('PASS project header and sidebar count: archived chats are excluded.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
