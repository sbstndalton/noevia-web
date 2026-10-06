// #942: the project delete flow, driven from the sidebar's project menu.
// (1) A failed DELETE /api/projects/<id> (500) shows an alert and the project stays.
// (2) Deleting another project while a free chat is open keeps you in that chat (same URL).
// (3) A project chat opened by address still leaves for Projects when its project is deleted.
// Synthetic projects only (diary-fixture + page.route).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const f=createFixture(0);await f.listen();const origin=`http://127.0.0.1:${f.server.address().port}`,browser=await chromium.launch(process.env.QA_CHROME_PATH?{headless:true,executablePath:process.env.QA_CHROME_PATH}:{headless:true,channel:'chrome'}),errors=[];
 const base={instructions:'',memories:[],files:[],sourceFolders:[],modes:['chat'],assets:[],toolboxes:[],createdAt:1,updatedAt:1};
 const chat=(id)=>({id,title:`Synthetic ${id}`,messages:[],updatedAt:2});
 async function open(path,{deleteStatus}){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  let projects=[{...base,id:'alpha',name:'Alpha project',goal:'',chats:[chat('pa1')]},{...base,id:'beta',name:'Beta project',goal:'',chats:[]}];
  const freeChats=[chat('free1')];
  const deletes=[];
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects,freeChats}}));
  await page.route('**/api/projects/*',r=>{
   if(r.request().method()!=='DELETE')return r.fallback();
   const id=decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());deletes.push(id);
   if(deleteStatus!==200)return r.fulfill({status:deleteStatus,json:{error:'synthetic failure'}});
   projects=projects.filter(p=>p.id!==id);return r.fulfill({json:{ok:true}});
  });
  await page.goto(origin+path);
  await page.getByRole('button',{name:'Open Alpha project',exact:true}).waitFor({timeout:10000});
  return {page,deletes};
 }
 async function deleteFromSidebar(page,name){
  // The row's context menu is the same project menu the ⋯ button opens.
  await page.getByRole('button',{name:`Open ${name}`,exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Delete project'}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor({timeout:5000});
  await dialog.getByRole('button',{name:'Delete project'}).click();
 }
 try{
  // (1) failed delete: an alert says so, and the project is still listed.
  {
   const {page,deletes}=await open('/projects',{deleteStatus:500});
   await page.locator('.project-card, [class*=project-card]',{hasText:'Alpha project'}).first().waitFor({timeout:10000});
   await deleteFromSidebar(page,'Alpha project');
   await page.waitForTimeout(800);
   assert.deepEqual(deletes,['alpha']);
   const alert=page.locator('.save-error[role=alert]');
   const shown=await alert.count();
   console.log({failedDeleteAlert:shown?(await alert.textContent()).trim():null});
   assert.equal(shown,1,'a failed project delete shows an alert');
   assert.match(await alert.textContent(),/delete the project/i);
   assert.equal(await page.getByRole('button',{name:'Open Alpha project',exact:true}).count(),1,'the project stays in the sidebar');
   assert.ok(await page.locator('.project-card, [class*=project-card]',{hasText:'Alpha project'}).count()>0,'the project card stays');
   await page.close();
  }
  // (2) deleting an unrelated project from a free chat keeps the chat open.
  {
   const {page,deletes}=await open('/c/free1',{deleteStatus:200});
   const before=new URL(page.url()).pathname;
   await deleteFromSidebar(page,'Beta project');
   await page.getByRole('button',{name:'Open Beta project',exact:true}).waitFor({state:'detached',timeout:10000});
   await page.waitForTimeout(500);
   const after=new URL(page.url()).pathname;
   console.log({freeChat:{before,after,deletes}});
   assert.equal(before,'/c/free1');
   assert.equal(after,before,'deleting another project keeps the free chat URL');
   assert.equal(await page.locator('.save-error[role=alert]').count(),0,'no error for a successful delete');
   await page.close();
  }
  // (3) deleting the project whose chat is open (opened by address) leaves for Projects, and
  // Back does not return to the deleted chat's address.
  {
   const {page}=await open('/c/pa1',{deleteStatus:200});
   await deleteFromSidebar(page,'Alpha project');
   await page.waitForURL(u=>new URL(u).pathname==='/projects',{timeout:10000});
   await page.goBack().catch(()=>{});await page.waitForTimeout(500);
   const back=new URL(page.url()).pathname;
   console.log({ownChat:{back}});
   assert.notEqual(back,'/c/pa1','Back never lands on the deleted project chat');
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS #942: failed delete is reported and kept; unrelated delete keeps the view; own-chat delete leaves cleanly.');
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
