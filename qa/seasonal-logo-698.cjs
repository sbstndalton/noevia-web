// #698: the logo and the tab-bar favicon follow the season automatically; hemisphere comes from the
// browser time zone; Appearance has no logo controls. Synthetic fixture only, no network, no inference.
// QA_DIST=<built dist> QA_SCREENSHOTS=<dir> node qa/seasonal-logo-698.cjs
const fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||`${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||`${os.homedir()}/Desktop/noevia-worktrees/shots-698`,port=Number(process.env.QA_PORT||31698);
const profile={user:{id:'synthetic',username:'fixture',displayName:'Synthetic QA',role:'admin',onboarded:true},passkeys:[]};
// Fixed "now" so the season is deterministic; the time zone decides the hemisphere.
const cases=[
 {name:'southern-summer',timezoneId:'Australia/Perth',now:'2027-01-15T12:00:00',palette:'summer'},
 {name:'northern-winter',timezoneId:'Europe/Oslo',now:'2027-01-15T12:00:00',palette:'winter'},
 {name:'southern-winter',timezoneId:'America/Sao_Paulo',now:'2027-07-15T12:00:00',palette:'winter'},
];
(async()=>{
 fs.mkdirSync(out,{recursive:true});const f=createFixture(port);await f.listen();
 const b=await chromium.launch({channel:'chrome',headless:true});let checks=0;const errors=[],icons={};
 try{
  for(const c of cases){
   const ctx=await b.newContext({locale:'en-GB',timezoneId:c.timezoneId,viewport:{width:1280,height:800},reducedMotion:'reduce'});
   const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.abort());
   await p.addInitScript(({now})=>{
    const fixed=new Date(now).getTime(),Real=Date;
    class MockDate extends Real{constructor(...a){a.length?super(...a):super(fixed);}static now(){return fixed;}}
    window.Date=MockDate;
    // Stale retired keys must be cleared on load.
    localStorage.setItem('noevia:logo-calendar','monthly');localStorage.setItem('noevia:logo-hemisphere','north');
   },{now:c.now});
   await p.route('**/api/profile',r=>r.fulfill({json:profile}));
   await p.goto(`http://localhost:${port}/`);
   await p.waitForFunction(()=>document.querySelector('link[rel="icon"]')?.getAttribute('href')?.startsWith('data:image/svg+xml'),null,{timeout:8000});
   const href=await p.evaluate(()=>document.querySelector('link[rel="icon"]').getAttribute('href'));
   const svg=decodeURIComponent(href.slice(href.indexOf(',')+1));
   assert.match(svg,/^<svg /);checks++;
   icons[c.name]=svg;
   assert.equal(await p.locator('html').getAttribute('data-logo-palette'),c.palette,c.name);checks++;
   assert.deepEqual(await p.evaluate(()=>[localStorage.getItem('noevia:logo-calendar'),localStorage.getItem('noevia:logo-hemisphere')]),[null,null]);checks++;
   const logo=p.locator('.side-logo').first();await logo.waitFor();
   await logo.screenshot({path:`${out}/sidebar-logo-${c.name}.png`});
   await p.goto(`http://localhost:${port}/settings/appearance`);
   await p.getByRole('heading',{name:/Appearance/}).first().waitFor();
   for(const name of [/logo/i,/hemisphere/i,/seasons/i,/monthly/i,/seasonal/i])assert.equal(await p.getByRole('combobox',{name}).count(),0,`no ${name} control`);
   assert.equal(await p.getByRole('button',{name:/test next palette/i}).count(),0);
   assert.equal(await p.locator('.logo-preview-controls').count(),0);
   assert.equal(await p.getByText(/hemisphere|monthly occasions|favicon stays/i).count(),0);checks+=4;
   await p.screenshot({path:`${out}/settings-appearance-${c.name}.png`});
   await ctx.close();
  }
  assert.notEqual(icons['southern-summer'],icons['northern-winter'],'favicon differs between southern summer and northern winter');checks++;
  assert.equal(icons['southern-winter'],icons['northern-winter'],'same season, same favicon, either hemisphere');checks++;
  const fills=s=>new Set(s.match(/fill="#[0-9A-Fa-f]{6}"/g));
  assert.notDeepEqual([...fills(icons['southern-summer'])].sort(),[...fills(icons['northern-winter'])].sort());checks++;
  // Season rollover while the tab stays open: the hourly/visibility check swaps the icon.
  const ctx=await b.newContext({locale:'en-GB',timezoneId:'Europe/Oslo'}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.route('https://**/*',r=>r.abort());await p.route('**/api/profile',r=>r.fulfill({json:profile}));
  await p.addInitScript(()=>{const Real=Date;window.__now=new Real('2027-02-28T23:59:00').getTime();
   class M extends Real{constructor(...a){a.length?super(...a):super(window.__now);}static now(){return window.__now;}}window.Date=M;});
  await p.goto(`http://localhost:${port}/`);
  const icon=()=>p.evaluate(()=>document.querySelector('link[rel="icon"]').getAttribute('href'));
  await p.waitForFunction(()=>document.documentElement.dataset.logoPalette==='winter'&&document.querySelector('link[rel="icon"]').getAttribute('href').startsWith('data:'));
  const winter=await icon();
  await p.evaluate(()=>{window.__now=new Date('2027-03-01T00:01:00').getTime();document.dispatchEvent(new Event('visibilitychange'));});
  await p.waitForFunction(()=>document.documentElement.dataset.logoPalette==='spring');
  await p.waitForFunction(old=>document.querySelector('link[rel="icon"]').getAttribute('href')!==old,winter);checks+=2;
  await ctx.close();
  assert.deepEqual(errors,[]);
  console.log(`seasonal-logo-698 QA passed: ${checks} checks`);
 }finally{await b.close();await f.close?.();}
})().catch(e=>{console.error(e);process.exitCode=1;});
