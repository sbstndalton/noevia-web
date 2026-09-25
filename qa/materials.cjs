// Full material inventory against synthetic APIs. Never connects to live services.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createFixture}=require('./diary-fixture.cjs');
const {navClick}=require('./nav.cjs');
const {withLocale}=require('./qa-locale.cjs');
const output=process.env.QA_SCREENSHOTS||'/tmp/noevia-material-audit';
const modes=['editorial','glass','contemporary']; // theme families (#249), formerly soft/liquid/material
const sections=process.env.QA_SECTIONS?.split('|')||['Appearance & language','Assistant & style','Usage','Your data & privacy','Diary & storage','Security and login','Account','Connected apps','AI providers','Users','Web address','Models & routing','Features','Experimental','Backups','Service status','Capabilities (status)'];
(async()=>{
 fs.mkdirSync(output,{recursive:true});const fixture=createFixture(31451);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[],errors=[];
 try{
 for(const width of [375,768,1440])for(const theme of ['light','dark'])for(const material of modes){
  const page=await browser.newPage(withLocale({viewport:{width,height:950},hasTouch:width<768}));
  page.on('pageerror',e=>errors.push({width,theme,material,error:e.message}));
  await page.addInitScript(({theme,material})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:theme-family',material);},{theme,material});
  const user={id:'synthetic-material-qa',username:'materialqa',displayName:'Material QA',role:'admin',diaryEnabled:true,onboarded:true};
  const project={id:'material-project',name:'Synthetic research',goal:'Compare the material treatments.',instructions:'',memories:[],files:[],assets:[],chats:[],toolboxes:['core'],modes:['chat','code'],createdAt:1000,updatedAt:1000};
  await page.route('**/api/profile',r=>r.fulfill({json:{user,passkeys:[]}}));
  await page.route('**/api/auth/session',r=>r.fulfill({json:{user,passkeys:[]}}));
  await page.route('**/api/features',r=>r.fulfill({json:{flags:{previews:true,codeHarness:true}}}));
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[project],freeChats:[]}}));
  await page.route('**/api/profile/appearance',r=>r.fulfill({json:{theme,light:'iris',dark:'iris'}}));
  // Give every lazy Settings panel complete synthetic data, not a generic {} response.
  await page.route('**/api/profile/app-passwords',r=>r.fulfill({json:{appPasswords:[]}}));
  await page.route('**/api/account/instructions',r=>r.fulfill({json:{text:'Use metric units.',style:'default',updatedAt:null,maxChars:4000}}));
  await page.route('**/api/account/memory',r=>r.fulfill({json:{memories:['Synthetic researcher'],useProjectMemories:true,updatedAt:null,maxItems:50,maxItemChars:300}}));
  await page.route('**/api/admin/web-address',r=>r.fulfill({json:{origin:'https://synthetic.invalid',source:'setup',previous:[],rpId:'synthetic.invalid'}}));
  await page.route('**/api/admin/users',r=>r.fulfill({json:{users:[user,{...user,id:'synthetic-member',username:'member',displayName:'Synthetic member',role:'member'}]}}));
  await page.route('**/api/admin/features',r=>r.fulfill({json:{features:[
   {name:'previews',label:'Preview surfaces',description:'Show preview surfaces.',enabled:true,source:'default',locked:false,env:'NOEVIA_FEATURE_PREVIEWS'},
   {name:'kiwix',label:'Offline Wikipedia',description:'Read-only reference lookup.',enabled:true,source:'env',locked:true,env:'NOEVIA_FEATURE_KIWIX'},
   {name:'systemOneRouting',label:'System-One routing',description:'Try alternative routing decisions.',enabled:false,source:'default',locked:false,experimental:true,env:'NOEVIA_FEATURE_SYSTEM_ONE_ROUTING'}]}}));
  await page.route('**/api/admin/decision-settings',r=>r.fulfill({json:{url:'http://synthetic.invalid:8040',timeoutMs:1500,source:'default'}}));
  const totals={input:13000,output:4200,replies:8};
  await page.route('**/api/usage**',r=>r.fulfill({json:{days:[{day:'2026-09-22',...totals}],allTime:totals,last7:totals,last30:totals,activeDays:1,currentStreak:1,longestStreak:1,models:[{name:'synthetic-model',...totals}],tools:[{name:'read_project_file',calls:9}],hours:Array.from({length:24},(_,h)=>h===14?8:0),peakHour:{hour:14,replies:8},retentionDays:365,timeZone:'America/New_York'}}));
  await page.goto('http://localhost:31451');await page.getByPlaceholder('Message noevia…').waitFor();
  const inspect=async(surface)=>{
   await page.waitForTimeout(80);
   const result=await page.evaluate(()=>{
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
    const blurred=[...document.querySelectorAll('*')].filter(visible).filter(e=>{const f=getComputedStyle(e).backdropFilter;return f&&f!=='none';}).map(e=>e.className.toString()).filter(Boolean);
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,blurred,material:document.documentElement.dataset.family,headings:[...document.querySelectorAll('h1,h2')].filter(visible).map(e=>e.textContent),failure:/Something went wrong|This panel couldn’t be displayed|Users could not be loaded|Usage could not be loaded/.test(document.body.innerText)};
   });
   const record={width,theme,material,surface,...result};results.push(record);
   if(width!==768)await page.screenshot({path:path.join(output,`${width}-${theme}-${material}-${surface.replace(/[^a-z0-9]+/gi,'-')}.png`)});
  };
  await inspect('Chat');
  await page.getByTitle('Settings',{exact:true}).click();
  const settings=page.getByRole('region',{name:'Settings',exact:true});await settings.waitFor();
  for(const section of sections){
   const back=settings.getByRole('button',{name:'All settings',exact:true});if(await back.isVisible())await back.click();
   await settings.locator('.settings-navigation').getByRole('button',{name:section,exact:true}).click();
   await page.waitForTimeout(140);
   await inspect('Settings '+section);
   const scroll=settings.locator('.settings-detail-scroll');
   if(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight+24)){await scroll.evaluate(e=>e.lastElementChild?.scrollIntoView({block:'end',behavior:'instant'}));await inspect('Settings '+section+' bottom');}
   if(section==='Appearance & language')assert.deepEqual(await settings.getByRole('radiogroup',{name:'Theme family'}).locator('.family-tile-name').allTextContents(),['Editorial','Contemporary','Glass']);
  }
  await settings.getByRole('button',{name:'Close settings',exact:true}).click();await settings.waitFor({state:'detached'});
  await navClick(page,'Projects');await page.getByRole('heading',{name:'Projects',exact:true,level:1}).waitFor();await inspect('Projects');
  await page.getByRole('button',{name:'Project options for Synthetic research'}).click();await page.getByRole('menu').waitFor();await inspect('Project menu');await page.keyboard.press('Escape');
  await navClick(page,'Customise');await page.waitForTimeout(200);await inspect('Customise');
  await navClick(page,'Diary');await page.waitForTimeout(200);await inspect('Diary');
  await page.close();
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
 const defects=results.filter(r=>r.overflow||r.failure||(['editorial','contemporary'].includes(r.material)&&r.blurred.length));
 console.log(JSON.stringify({surfaces:results.length,errors,defects},null,2));
 assert.deepEqual(errors,[]);assert.deepEqual(defects,[]);
 console.log('PASS material inventory: all settings, chat, projects, menus, plugins and Diary; three modes, two themes, three sizes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
