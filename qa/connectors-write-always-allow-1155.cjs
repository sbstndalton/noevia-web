// #1155 — choosing "Always allow" on a write tool used to do nothing, silently. It must now say
// why, visibly, and still change nothing. Synthetic fixture only (Nextcloud + Drive connectors).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const PORT=Number(process.env.QA_PORT||31416);
(async()=>{
 const fixture=createFixture(PORT);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});let failed=false;
 try{
  const page=await browser.newPage(withLocale({viewport:{width:1440,height:900}}));
  await page.goto(`http://localhost:${PORT}`);await page.getByPlaceholder('Message noevia…').waitFor();
  await page.getByRole('button',{name:'Customise',exact:true}).click();
  const s=page.locator('.plugins-page');await s.getByRole('button',{name:'Nextcloud'}).click();
  await s.getByRole('heading',{name:'Nextcloud',level:1}).waitFor();
  const group=s.getByRole('radiogroup',{name:'nc_notes_create permission'});
  const writes=[];page.on('request',r=>{if(/connectors|policy/.test(r.url())&&r.method()!=='GET')writes.push(r.method()+' '+r.url());});
  assert.equal(await s.getByRole('status').filter({hasText:/Writes always need/}).count(),0,'no message before the click');
  await group.getByRole('radio',{name:/Always allow/}).click({force:true}); // aria-disabled: a real user can still press it
  try{
   await s.getByRole('status').filter({hasText:/Writes always need your approval/}).waitFor({timeout:2000});
  }catch{console.log('FAIL #1155: clicking Always allow on a write gave no visible message');failed=true;}
  if(process.env.QA_SHOTS)await group.locator('xpath=ancestor::section[contains(@class,"perm-group")]').screenshot({path:`${process.env.QA_SHOTS}/always-allow-1155.png`});
  assert.equal(await group.getByRole('radio',{name:'Needs approval'}).getAttribute('aria-checked'),'true','still needs approval');
  assert.equal(writes.length,0,'nothing was sent');
 }finally{await browser.close();await fixture.close?.();}
 if(failed)process.exitCode=1;else console.log('PASS connectors-write-always-allow-1155');
})().catch(e=>{console.error(e);process.exitCode=1;});
