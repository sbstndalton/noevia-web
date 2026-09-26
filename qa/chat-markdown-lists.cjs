// #431: chat Markdown lists (bullet, ordered, task) must render as real <ul>/<ol>/<li>, not one
// flat <p class="md-bullet"> per line — a screen reader gets no list semantics from a paragraph.
// Must fail on main (no ul/ol/li in the transcript at all) and pass after the fix.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');

(async()=>{
 const fixture=createFixture(31395);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:31395');
  const box=page.getByRole('textbox',{name:'Message',exact:true});
  await box.fill('markdown lists synthetic');
  await box.press('Enter');
  await page.getByTitle('Stop generating').waitFor({state:'detached',timeout:8000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector('.transcript')?.textContent.includes('Already done'),null,{timeout:5000});

  const counts=await page.evaluate(()=>({
    ul:document.querySelectorAll('.transcript ul > li').length,
    ol:document.querySelectorAll('.transcript ol > li').length,
    checkboxes:document.querySelectorAll('.transcript input[type="checkbox"]').length,
    checkedCount:document.querySelectorAll('.transcript input[type="checkbox"]:checked').length,
    flatBullets:document.querySelectorAll('.transcript .md-bullet').length,
    nestedUl:document.querySelectorAll('.transcript ul > li > ul').length,
    nestedOl:document.querySelectorAll('.transcript ol > li > ol').length,
  }));
  console.log(JSON.stringify(counts));

  assert.ok(counts.ul>0,'.transcript ul > li must exist for a bulleted reply');
  assert.ok(counts.ol>0,'.transcript ol > li must exist for an ordered reply');
  assert.equal(counts.checkboxes,2,'both task-list lines must render as real checkboxes');
  assert.equal(counts.checkedCount,1,'exactly the "[x]" item must be checked');
  assert.equal(counts.flatBullets,0,'the old flat <p class="md-bullet"> rendering must be gone');
  assert.ok(counts.nestedUl>0,'the nested sub-bullets must be a real nested <ul>, not flat padding');
  assert.ok(counts.nestedOl>0,'the nested ordered item must be a real nested <ol>, not flat padding');

  assert.deepEqual(errors,[]);
  console.log('PASS chat markdown lists: real <ul>/<ol>/<li> with nesting and checkbox state.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
