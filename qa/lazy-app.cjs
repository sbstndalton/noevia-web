// Built app integration: hold each real lazy chunk while keeping the shell usable.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31423);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  for(const [name,chunk,view,settings] of [['Projects','ProjectsView','projects',null],['Diary','DiaryView','diary',null],['Models','ModelManagerPage','models',null],['Settings','SettingsShell','projects','general'],['Coding','CodingWorkspace','projects',null]]) {
   const page=await browser.newPage();let release;const held=new Promise(r=>release=r);
   await page.addInitScript(({view,settings})=>localStorage.setItem('noevia:last-view',JSON.stringify({user:'synthetic-diary-only',view:{kind:view},settings})),{view,settings});
   await page.route('**/api/features',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({flags:{previews:true}})}));
   await page.route('**/assets/'+chunk+'-*.js',async r=>{await held;await r.continue();});
   await page.goto('http://localhost:31423');
   if(name==='Coding')await page.getByRole('button',{name:'Code',exact:true}).click();
   const status=page.getByRole('status').filter({hasText:'Loading '+name+'…'});
   await status.waitFor();assert.equal(await page.locator('.view-loading:visible').count(),1);
   assert.ok(await page.locator('#app-navigation').isVisible(), name + ': navigation remains visible');
   release();await status.waitFor({state:'hidden'});await page.close();
  }
  console.log('Built app: each of five delayed chunks shows one visible status and retains navigation; resolved chunks replace status.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
