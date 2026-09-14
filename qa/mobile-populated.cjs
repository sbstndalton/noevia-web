// Synthetic populated projects and uploads at touch sizes; approvals: mobile-approvals.cjs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const longName='Synthetic-'+('unbroken-filename-'.repeat(12))+'.docx';
const file={name:'Synthetic uploads/Documents/'+longName,source:'Synthetic uploads',content:'',attachment:{kind:'document',state:'stored',reason:'Synthetic original stored for compatibility testing.',bytes:2048,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}};
(async()=>{
 const fixture=createFixture(31332);await fixture.listen();const browser=await chromium.launch({headless:true,channel:'chrome'});
 const errors=[];
 try{
 for(const [width,height] of [[320,568],[375,667],[390,360],[667,375],[768,1024],[1440,900]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height},isMobile:width<768,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  const project={id:'synthetic-populated',name:'Synthetic populated project',model:'Synthetic model',files:[file],assets:[],chats:[],memories:[],instructions:'',goal:'',sourceFolders:['Synthetic uploads','Synthetic reference/'+longName],projectFolder:'Synthetic uploads',toolboxes:['core'],createdAt:Date.now(),updatedAt:Date.now()};
  await page.addInitScript(t=>localStorage.setItem('cowork-theme',t),theme);
  await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[project],freeChats:[]}}));
  await page.route('**/api/projects/synthetic-populated/sources/sync?background=1',r=>r.fulfill({json:{files:[],skipped:[]}}));
  await page.route('**/api/projects/synthetic-populated/skills',r=>r.fulfill({json:{skills:[]}}));
  await page.goto('http://localhost:31332');await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.locator('.project-card').filter({hasText:project.name}).click();
  await page.getByRole('tab',{name:/Sources/}).click();await page.locator('.project-sources').waitFor();
  const fit=async(label)=>{
   const bad=await page.locator('.project-sources, .project-main, .source-actions, .source-list li').evaluateAll(els=>els.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({class:el.className,client:el.clientWidth,scroll:el.scrollWidth})));
   assert.deepEqual(bad,[],`${width} ${theme} ${label}`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label);
  };
  const reachable=async(locator)=>{await locator.scrollIntoViewIfNeeded();assert.ok(await locator.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),'Touch control reachable');};
  await fit('populated sources');
  await reachable(page.getByRole('button',{name:'Delete '+file.name,exact:true}));
  await page.getByRole('button',{name:'Delete '+file.name,exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await page.screenshot({path:`/tmp/noevia-populated-delete-${width}-${theme}.png`});
  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'Delete dialog fits long filename');
  await reachable(dialog.getByRole('button',{name:'Cancel',exact:true}));await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('.project-linked-folders summary').click();await fit('linked folder');
  await page.route('**/api/projects/synthetic-populated/upload?background=1',async r=>{await new Promise(resolve=>setTimeout(resolve,150));await r.fulfill({status:413,json:{error:'Synthetic file rejected; select a smaller file.'}});});
  await page.locator('.project-sources input[type=file]').setInputFiles({name:longName,mimeType:'text/plain',buffer:Buffer.from('Synthetic upload fixture')});
  await page.locator('summary').filter({hasText:'Upload results'}).click();
  await page.getByText('Synthetic file rejected; select a smaller file.').waitFor();
  await fit('upload failure');
  await page.locator('.upload-progress').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/noevia-populated-upload-${width}-${theme}.png`});
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS populated mobile projects: source actions, long filenames/folders, deletion cancel, upload error/progress; six viewports in both themes.');
 }finally{await browser.close();await fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
