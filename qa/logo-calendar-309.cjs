// All data and accounts are synthetic. No real settings or inference.
const fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||`${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-logo-309-qa',port=Number(process.env.QA_PORT||31509);
const palettes=['spring','summer','autumn','winter','rose','clover','harvest','festive','default'];
(async()=>{
 fs.mkdirSync(out,{recursive:true});const f=createFixture(port);await f.listen();const b=await chromium.launch({channel:'chrome',headless:true});let checks=0;const errors=[];
 try{
 for(const width of [1440,768,390])for(const theme of ['light','dark'])for(const family of ['editorial','contemporary','glass']){
  const name=`${family}-${theme}-${width}`,p=await b.newPage({locale:'en-GB',viewport:{width,height:900},reducedMotion:'reduce'});
  p.on('pageerror',e=>errors.push(e.message));await p.route('https://**/*',r=>r.abort());
  await p.addInitScript(({theme,family})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:theme-family',family);},{theme,family});
  await p.route('**/api/profile',r=>r.fulfill({json:{user:{id:'synthetic',username:'fixture',displayName:'Synthetic QA',role:'admin',onboarded:true},passkeys:[]}}));
  await p.goto(`http://localhost:${port}/settings/appearance`);const mode=p.getByRole('combobox',{name:'Logo colours',exact:true});await mode.waitFor();
  const value=()=>p.locator('html').getAttribute('data-logo-palette');
  assert.equal(await value(),'default');checks++;
  for(const palette of palettes){
   await p.getByRole('button',{name:'Test next palette',exact:true}).click();assert.equal(await value(),palette);checks++;
   assert.equal(await p.evaluate(()=>localStorage.getItem('noevia:logo-calendar')),null);checks++;
   const mark=p.locator('.logo-preview-mark');await mark.scrollIntoViewIfNeeded();
   await mark.screenshot({path:`${out}/${name}-${palette}.png`});
  }
  await p.getByRole('button',{name:'End preview',exact:true}).click();
  await mode.selectOption('seasonal');assert.equal(await p.getByRole('combobox',{name:'Seasons',exact:true}).count(),1);checks++;
  const north=await value();await p.getByRole('combobox',{name:'Seasons',exact:true}).selectOption('south');assert.notEqual(await value(),north);checks++;
  await mode.selectOption('monthly');assert.equal(await p.evaluate(()=>localStorage.getItem('noevia:logo-calendar')),'monthly');checks++;
  await p.reload();await mode.waitFor();assert.equal(await mode.inputValue(),'monthly');assert.equal(await p.getByRole('combobox',{name:'Seasons',exact:true}).inputValue(),'south');checks+=2;
  const savedPalette=await value();
  await p.getByRole('button',{name:'Test next palette',exact:true}).click();assert.equal(await value(),'spring');checks++;
  if(savedPalette==='spring')await p.getByRole('button',{name:'Test next palette',exact:true}).click();
  await p.getByRole('button',{name:'Close settings',exact:true}).click();
  await p.waitForFunction(expected=>document.documentElement.dataset.logoPalette===expected,savedPalette);assert.equal(await value(),savedPalette);checks++;
  await p.goto(`http://localhost:${port}/settings/appearance`);await mode.waitFor();
  await mode.selectOption('default');assert.equal(await value(),'default');checks++;
  await p.locator('.logo-preview-controls').scrollIntoViewIfNeeded();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;
  await p.screenshot({path:`${out}/${name}-settings.png`});await p.close();
 }
 const member=await b.newPage({locale:'en-GB'});await member.route('https://**/*',r=>r.abort());await member.goto(`http://localhost:${port}/settings/appearance`);
 await member.getByRole('combobox',{name:'Logo colours',exact:true}).waitFor();assert.equal(await member.getByRole('button',{name:'Test next palette'}).count(),0);checks++;
 await member.close();assert.deepEqual(errors,[]);assert.equal(f.requests.length,0);checks+=2;
 fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,errors},null,2));console.log({checks,errors});
 }finally{await b.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
