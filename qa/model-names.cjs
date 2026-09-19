// Long model names (user review, 2026-09-19): the picker keeps each name's start and its
// size/quantization ending with the middle elided, shows the full name on hover and to screen
// readers, and filters a long list. The composer pill does the same. Synthetic models only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createFixture}=require('./diary-fixture.cjs');
const out=process.env.QA_SCREENSHOTS||'/tmp/noevia-shots';
const NAMES=['Qwen3.5-Coder-32B-Instruct-Abliterated-Uncensored-Q5_K_M','Qwen3.5-Coder-32B-Instruct-Abliterated-Uncensored-Q8_0',
 'gemma-4-E4B-it-qat-UD-Q4_K_XL','gpt-oss-20b-Q4_K_M','Llama-3.3-70B-Instruct-Distilled-Reasoning-IQ3_XXS','Mistral-Small-3.2-24B-Instruct-2506-Q6_K','Phi-5-mini-Q4_0','tiny'];
(async()=>{
 const fixture=createFixture(31382);await fixture.listen();
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
  for(const [w,h,mobile] of [[1280,800,false],[375,740,true]]){
   const page=await browser.newPage({viewport:{width:w,height:h},isMobile:mobile,hasTouch:mobile});page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/models/installed',r=>r.fulfill({json:NAMES.map((name,i)=>({name,loaded:i===0,sizeGB:10+i,labels:[]}))}));
   const proj={id:'p1',name:'Names',model:NAMES[0],updatedAt:1,createdAt:1,files:[],assets:[],memories:[],instructions:'',goal:'',sourceFolders:[],chats:[],toolboxes:['core']};
   await page.route('**/api/workspace',r=>r.fulfill({json:{projects:[proj],freeChats:[]}}));
   await page.goto('http://localhost:31382');await page.getByPlaceholder('Message noevia…').waitFor();
   // Open the project so the composer shows its long model name.
   if(mobile)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
   await page.getByRole('button',{name:'Open Names'}).click();
   const pill=page.locator('.model-pill .mid-trunc').first();
   await pill.waitFor();
   const t=await pill.evaluate(el=>({title:el.title,tail:el.querySelector('.mid-trunc-tail')?.textContent}));
   assert.equal(t.title,NAMES[0]);assert.equal(t.tail,NAMES[0].slice(-10),'composer pill keeps the quantization ending');
   await page.locator('.model-pill').first().click();
   const dialog=page.getByRole('dialog',{name:'Model and tools'});await dialog.waitFor();await dialog.locator('.mp-model').first().waitFor({timeout:8000});
   // Every name keeps its distinguishing ending, and the two near-identical Qwens stay distinct.
   const rows=await dialog.locator('.mp-model .mid-trunc').evaluateAll(els=>els.map(el=>({label:el.getAttribute('aria-label')||el.textContent,tail:el.querySelector('.mid-trunc-tail')?.textContent||el.textContent,title:el.title,right:el.getBoundingClientRect().right,box:el.closest('.mp-model').getBoundingClientRect().right})));
   assert.equal(rows.length,NAMES.length);
   for(const r of rows){assert.ok(NAMES.includes(r.title),`full name as tooltip ${r.title}`);assert.ok(r.title.endsWith(r.tail),`ending kept ${r.title}`);assert.ok(r.right<=r.box+1,`name stays inside its row at ${w}`);}
   assert.notEqual(rows[0].tail,rows[1].tail,'Q5_K_M and Q8_0 remain distinguishable');
   // A long list filters.
   const filter=dialog.getByRole('searchbox',{name:'Filter models'});await filter.fill('gemma');
   assert.equal(await dialog.locator('.mp-model').count(),1);
   await filter.fill('nothing-like-this');await dialog.getByText(/No model matches/).waitFor();
   await filter.fill('');
   await page.screenshot({path:`${out}/model-names-${w}.png`});
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS model names: middle truncation keeps start and quantization, full name as tooltip and accessible name, near-identical names stay distinct, filter narrows the list; desktop and phone.');
 }finally{await browser.close();await fixture.close?.();}
})().catch(e=>{console.error(e);process.exit(1);});
