// #492/#493: real app, synthetic routes only. Chrome runs every family × mode × width,
// all accent palettes, and representative controls/fields/cards/menus/sheets.
// QA_DIST=/tmp/build QA_SCREENSHOTS=/tmp/theme-shots node qa/theme-shape-material-492.cjs
// #529: the model control is .composer-model; the phone composer's compact button (#527) is not a .model-pill.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {openSettings}=require('./nav.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||`${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const {createFixture}=require('./diary-fixture.cjs');
const {withLocale}=require('./qa-locale.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-theme-shape';
const checks=[],failures=[],errors=[];
function check(ok,description,detail){checks.push({description,ok,detail});if(!ok)failures.push({description,detail});}
async function radius(page,selector){return page.locator(selector).first().evaluate(e=>getComputedStyle(e).borderTopLeftRadius);}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const fixture=createFixture(Number(process.env.QA_PORT||31492));await fixture.listen();
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [1440,768,390])for(const theme of ['light','dark'])for(const family of ['editorial','contemporary','glass']){
   const name=`${family}-${theme}-${width}`,shape={editorial:{control:10,button:10,input:10,overlay:14,surface:20},contemporary:{control:8,button:999,input:4,overlay:16,surface:28},glass:{control:12,button:12,input:12,overlay:18,surface:24}}[family];
   const page=await browser.newPage(withLocale({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390}));
   page.on('pageerror',e=>errors.push({name,error:e.message}));
   await page.route('https://**/*',r=>r.abort());
   await page.addInitScript(({theme,family})=>{localStorage.setItem('cowork-theme',theme);localStorage.setItem('noevia:theme-family',family);},{theme,family});
   const user={id:'synthetic-shape',username:'shapeqa',displayName:'Theme QA',role:'member',diaryEnabled:false,onboarded:true};
   await page.route('**/api/profile',r=>r.fulfill({json:{user,passkeys:[]}}));
   await page.route('**/api/auth/session',r=>r.fulfill({json:{user,passkeys:[]}}));
   await page.route('**/api/profile/appearance',r=>r.fulfill({json:{theme,light:'iris',dark:'iris'}}));
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[],freeChats:Array.from({length:24},(_,i)=>({id:`synthetic-${i}`,title:`Synthetic theme history ${i}`,updatedAt:1000-i,pinned:false}))}}));
   await page.goto(`http://localhost:${process.env.QA_PORT||31492}`);await page.getByPlaceholder('Message noevia…').waitFor();
   const shot=async(label)=>{await page.screenshot({path:path.join(out,`${name}-${label}.png`)});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);check(!overflow,`${name} ${label}: no horizontal overflow`);};
   for(const palette of ['iris','warm','cool','neutral','sage']){
    await page.evaluate(p=>document.documentElement.dataset.palette=p,palette);
    await shot(`home-${palette}`);
   }
   await page.evaluate(()=>document.documentElement.dataset.palette='iris');
   for(const [selector,role] of [['.composer-inner','surface'],['.composer-mode-toggle','button'],['.tool-catalogue-trigger','button'],['.composer .composer-model','control']]){
    const actual=await radius(page,selector);check(actual===`${shape[role]}px`,`${name} ${selector}: ${role} role`,actual);
   }
   // A token perturbation proves propagation, rather than only checking coincidental pixels.
   await page.evaluate(()=>document.documentElement.style.setProperty('--radius-button','17px'));
   check(await radius(page,'.tool-catalogue-trigger')==='17px',`${name}: button token propagates to composer tool control`);
   await page.evaluate(()=>document.documentElement.style.removeProperty('--radius-button'));
   await page.getByRole('button',{name:'Add files and tools'}).click();
   const menu=page.locator('.composer-actions-panel');await menu.waitFor();await page.waitForTimeout(260);
   check(await radius(page,'.composer-actions-panel')===`${shape.overlay}px`,`${name}: menu radius`);
   await shot('menu');
   if(family==='glass'){
    const material=await menu.evaluate(e=>({fill:getComputedStyle(e).getPropertyValue('--glass-pane-fill').trim(),filter:getComputedStyle(e).backdropFilter}));
    check(/0\.97|97%/.test(material.fill),`${name}: foreground material obscures nested-root content`,material);
    // Remove filtering to exercise the material's real fallback, not an assumed blur.
    await menu.evaluate(e=>{e.style.backdropFilter='none';e.style.webkitBackdropFilter='none';});
    await shot('menu-no-filter');
    const cdp=await page.context().newCDPSession(page);
    for(const [feature,value] of [['prefers-reduced-transparency','reduce'],['prefers-contrast','more']]){
     await cdp.send('Emulation.setEmulatedMedia',{features:[{name:feature,value}]});
     const filtered=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).backdropFilter!=='none';}).map(e=>e.className));
     check(filtered.length===0,`${name}: ${feature} removes all visible backdrop filters`,filtered);
     await shot(feature);
    }
    await cdp.send('Emulation.setEmulatedMedia',{features:[]});await cdp.detach();
   }
   await page.keyboard.press('Escape');
   await page.locator('.composer .composer-model').first().click();await page.locator('.mp-panel').waitFor();await page.waitForTimeout(320);
   check(await radius(page,'.mp-panel')===`${shape.surface}px`,`${name}: dialog/sheet radius`);await shot('sheet');await page.keyboard.press('Escape');
   if(await page.locator('.mp-panel').isVisible())await page.mouse.click(2,2);
   await openSettings(page);
   const settings=page.getByRole('region',{name:'Settings',exact:true});await settings.waitFor();
   const back=settings.getByRole('button',{name:'All settings',exact:true});if(await back.isVisible())await back.click();
   await settings.locator('.settings-navigation').getByRole('button',{name:'Appearance & language',exact:true}).click();
   const familyChoice=settings.getByRole('radiogroup',{name:'Theme family'});await familyChoice.waitFor();
   const select=settings.locator('select').first();
   check(await select.evaluate(e=>getComputedStyle(e).borderTopLeftRadius)===`${shape.input}px`,`${name}: native field radius`);
   check(await radius(page,'.settings-stage .set-rows')===`${shape.overlay}px`,`${name}: grouped card radius`);
   const buttons=settings.locator('.theme-choice button');
   check(await buttons.first().evaluate(e=>getComputedStyle(e).borderTopLeftRadius)===`${shape.overlay}px`,`${name}: appearance preview card radius`);
   await familyChoice.scrollIntoViewIfNeeded();await shot('settings');
   // Preferences are device-local in this synthetic browser. Exercise every exposed value.
   for(const density of ['comfortable','compact'])for(const font of ['sans','serif','mono']){
    await page.evaluate(({density,font})=>{document.documentElement.dataset.density=density;document.documentElement.dataset.chatFont=font;},{density,font});
    await shot(`preferences-${density}-${font}`);
   }
   await page.evaluate(()=>{document.documentElement.dataset.density='comfortable';document.documentElement.dataset.chatFont='sans';});
   for(const motion of ['system','reduced']){
    await settings.getByRole('radiogroup',{name:'Motion',exact:true}).getByRole('radio',{name:motion==='system'?'System':'Reduced',exact:true}).click();
    check(await page.evaluate(()=>document.documentElement.dataset.motion)===motion,`${name}: motion ${motion} applies`);
   }
   for(const layout of ['auto','mobile','desktop']){
    await page.evaluate(mode=>window.noeviaLayout.set(mode),layout);
    check(await page.evaluate(()=>document.documentElement.dataset.layoutMode)===layout,`${name}: layout ${layout} applies`);
    await shot(`layout-${layout}`);
   }
   fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,failures,errors},null,2));
   await page.close();
  }
  check(errors.length===0,'no browser errors',errors);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,failures,errors},null,2));
  console.log(`${checks.length} checks; ${failures.length} failures; ${errors.length} browser errors; ${out}`);
  if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
