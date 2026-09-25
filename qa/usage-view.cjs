// Settings → Usage against synthetic APIs only. Every number on the page must
// come from the summary the server returns: what is absent says so rather than
// showing a plausible figure.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
// Below 600px the settings button lives in the navigation drawer, and the
// shell animates in, so wait for it to settle before clicking.
async function openSettings(page){
 // Settings is a remembered view: after a reload the panel is already open and
 // its button is not on screen.
 if(await page.getByRole('region',{name:'Settings'}).isVisible())return;
 const toggle=page.getByRole('button',{name:'Open navigation',exact:true});
 if(await toggle.isVisible()){await toggle.click();await page.getByRole('dialog',{name:'Navigation'}).waitFor();}
 // The account menu carries Settings at every width; the header icon does not.
 await page.getByRole('button',{name:/Account menu for/}).locator('visible=true').first().click();
 await page.locator('.account-popover').getByRole('button',{name:'Settings',exact:true}).click();
}
const day=n=>{const d=new Date();d.setDate(d.getDate()-n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
(async()=>{
 const fixture=createFixture(31358);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  const totals=(input,output,replies)=>({input,output,replies});
  const summary=(extra)=>({days:[{day:day(2),...totals(0,0,0)},{day:day(1),...totals(4000,1200,3)},{day:day(0),...totals(9000,3000,5)}],
   allTime:totals(13000,4200,8),last7:totals(13000,4200,8),last30:totals(13000,4200,8),
   activeDays:2,currentStreak:2,longestStreak:2,models:[{name:'qwen3-30b',...totals(10000,3200,6)},{name:'qwen3-4b',...totals(3000,1000,2)}],
   retentionDays:365,timeZone:'Europe/Oslo',...extra});
  const open=async(width,theme,payload)=>{
   const page=await browser.newPage(withLocale({viewport:{width,height:950},isMobile:width<768,hasTouch:width<768}));
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
   await page.route('**/api/usage**',r=>r.fulfill({json:payload}));
   await page.goto('http://localhost:31358');
   await page.getByPlaceholder('Message noevia…').waitFor();
   await openSettings(page);
   await page.getByRole('button',{name:'Usage',exact:true}).locator('visible=true').first().click();
   await page.getByRole('heading',{name:'Usage',level:1}).waitFor();
   return page;
  };
  const recorded=summary({tools:[{name:'read_project_file',calls:9},{name:'nc_notes_search',calls:2}],hours:Array.from({length:24},(_,h)=>h===14?6:h===9?2:0),peakHour:{hour:14,replies:6}});
  const nothing=summary({tools:[],hours:Array.from({length:24},()=>0),peakHour:null,models:[],days:[],allTime:totals(0,0,0),last7:totals(0,0,0),last30:totals(0,0,0),activeDays:0,currentStreak:0,longestStreak:0});
  for(const [width,theme] of [[1440,'light'],[390,'dark']]){
   const page=await open(width,theme,recorded);
   const stat=async label=>(await page.locator('.usage-stat').filter({hasText:label}).first().locator('.usage-stat-value').innerText()).trim();
   assert.equal(await stat('Peak hour'),'2 pm','the peak hour is shown on a clock people read');
   assert.equal(await stat('Favourite model'),'qwen3-30b');
   assert.equal(await stat('Tool calls'),'11');
   await page.getByRole('heading',{name:'Tools'}).waitFor();
   assert.match(await page.locator('.model-row').filter({hasText:'read_project_file'}).innerText(),/9 calls/);
   if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/usage-view-${width}-${theme}.png`,fullPage:true});
   await page.close();

   // An account with nothing recorded yet must not invent a peak hour, a
   // favourite model or a tool count.
   const empty=await open(width,theme,nothing);
   const emptyStat=async label=>(await empty.locator('.usage-stat').filter({hasText:label}).first().locator('.usage-stat-value').innerText()).trim();
   assert.equal(await emptyStat('Peak hour'),'—');
   assert.equal(await emptyStat('Favourite model'),'—');
   assert.equal(await emptyStat('Tool calls'),'0');
   assert.equal(await empty.getByRole('heading',{name:'Tools'}).count(),0,'an empty Tools section must not render');
   await empty.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS usage view: peak hour on a readable clock, favourite model, tool-call total and per-tool list from the summary, and an account with nothing recorded says so instead of inventing figures. 1440 light, 390 dark.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
