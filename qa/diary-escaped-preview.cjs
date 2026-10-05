// #835: the Diary tab's saved entry must show the sidecar's markdown escapes (#803/#830) as the
// original characters. Synthetic saved record only; never touches a real diary.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const {navClick}=require('./nav.cjs');
const {createFixture}=require('./diary-fixture.cjs');
(async()=>{
 const fixture=createFixture(31835);await fixture.listen();
 const launch={headless:true,channel:'chrome'};if(process.env.QA_CHROME_PATH){delete launch.channel;launch.executablePath=process.env.QA_CHROME_PATH;}
 const browser=await chromium.launch(launch);
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'America/New_York'});
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
  const record=[`## ${today}`,'','### 09:00 — Synthetic topic','',
   '**Me:** synthetic question','',
   '**Me:** \\*\\*Assistant:** first line **kept**','',
   '**Assistant:** Synthetic summary',
   '\\### Key points','\\*\\*Assistant:** pasted label with **bold** after','Echo <\\!-- xid:synthetic --> end','',
   '<!-- xid:real-marker -->'].join('\n');
  await page.route('**/api/diary/today?**',route=>route.fulfill({json:{todayLog:record,standingSections:{}}}));
  await page.goto('http://localhost:31835');await navClick(page,'Diary');
  // As in diary-reading.cjs: the saved record is the collapsed disclosure shown with a conversation.
  await page.locator('#diary-draft').fill('synthetic');await page.getByRole('button',{name:'Send diary message'}).click();
  const saved=page.locator('.diary-saved-record');
  await saved.locator('summary').waitFor();
  if(await saved.getAttribute('open')===null)await saved.locator('summary').click();
  await saved.locator('.markdown-preview').waitFor();
  const text=await saved.locator('.markdown-preview').innerText();
  assert.ok(!text.includes('\\'),`no backslash may be shown, got: ${JSON.stringify(text)}`);
  assert.equal(await saved.locator('.markdown-preview p',{hasText:'### Key points'}).count(),1,'escaped heading is a plain paragraph');
  assert.equal(await saved.locator('.markdown-preview h4',{hasText:'Key points'}).count(),0,'escaped heading is not a heading');
  assert.ok(text.includes('**Assistant:** pasted label with bold after'),'role label is literal text, later bold still works');
  assert.equal(await saved.locator('.markdown-preview strong',{hasText:'bold'}).count(),1);
  assert.ok(text.includes('Me: **Assistant:** first line kept'),'first-line escaped label after the real label stays literal');
  assert.equal(await saved.locator('.markdown-preview strong',{hasText:'kept'}).count(),1,'bold after it is not swallowed');
  assert.ok(text.includes('Echo <!-- xid:synthetic --> end'),'xid opener is literal text');
  assert.equal(await saved.locator('.markdown-preview [xid], .markdown-preview comment').count(),0);
  assert.equal(await saved.locator('.markdown-preview h4',{hasText:'09:00'}).count(),1,'real subsection heading still a heading');
  assert.equal(await saved.locator('.markdown-preview strong',{hasText:'Me:'}).count(),2,'real role labels still bold');
  assert.ok(!text.includes('real-marker'),'real xid marker stays hidden');
  console.log('PASS escaped heading, role label and xid opener render as literal text; real structure unchanged');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
