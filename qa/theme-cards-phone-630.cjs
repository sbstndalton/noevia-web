// #630: Settings > Appearance > Theme keeps all three cards (System / Light / Dark) inside its row
// on a real phone (375 / 414 px, mobile user agent) and in the phone layout preview
// (data-layout="mobile") on a wide desktop viewport, in light and dark. Real app, synthetic data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const PORT=31383,origin=`http://localhost:${PORT}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'';
const MOBILE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-theme-630-')),data=path.join(root,'data');fs.mkdirSync(data);
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setupCode=fs.readFileSync(path.join(data,'first-run-setup-code'),'utf8').trim();
  const boot=await browser.newContext();const bp=await boot.newPage();
  const api=(page,url,body)=>page.evaluate(async({url,body})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});return r.status;},{url,body});
  await bp.goto(origin);
  assert.equal(await api(bp,'/api/setup/complete',{setupCode,publicOrigin:origin,username:'themeqa',displayName:'Synthetic theme admin',password:'synthetic password QA',diaryEnabled:false}),201);
  await api(bp,'/api/profile/onboarding',{});
  const state=await boot.storageState();await boot.close();
  const cases=[
   {name:'phone-375',viewport:{width:375,height:812},mobile:true,layout:'auto'},
   {name:'phone-414',viewport:{width:414,height:896},mobile:true,layout:'auto'},
   {name:'preview-375',viewport:{width:375,height:812},mobile:false,layout:'mobile'},
   {name:'preview-1400',viewport:{width:1400,height:900},mobile:false,layout:'mobile'},
  ];
  for(const c of cases)for(const theme of ['light','dark']){
   const ctx=await browser.newContext({storageState:state,viewport:c.viewport,isMobile:c.mobile,hasTouch:c.mobile,userAgent:c.mobile?MOBILE_UA:undefined});
   await ctx.addInitScript(([t,l])=>{localStorage.setItem('cowork-theme',t);localStorage.setItem('cowork-layout-mode',l);},[theme,c.layout]);
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/settings/appearance');
   assert.equal(await page.evaluate(()=>document.documentElement.getAttribute('data-layout')),'mobile',`${c.name}: phone layout active`);
   const cards=page.locator('.theme-choice button');await cards.first().waitFor();
   assert.equal(await cards.count(),3,`${c.name} ${theme}: three theme cards`);
   // The saved preference wins over localStorage, so choose the theme the way a person does.
   await page.locator('.theme-choice').getByRole('button',{name:theme==='dark'?'Dark':'Light',exact:true}).click();
   await page.waitForFunction(t=>document.documentElement.getAttribute('data-theme')===t,theme);
   const m=await page.evaluate(()=>{const tc=document.querySelector('.theme-choice');const row=tc.closest('.set-row')||tc.parentElement;const r=row.getBoundingClientRect();
    const list=[...document.querySelectorAll('.theme-choice button')].map(b=>{const x=b.getBoundingClientRect();return{l:x.left,r:x.right};});
    return{rowL:r.left,rowR:r.right,list,scroll:tc.scrollWidth,client:tc.clientWidth,doc:document.documentElement.scrollWidth,vw:innerWidth};});
   for(const [i,b] of m.list.entries())assert.ok(b.l>=m.rowL-0.5&&b.r<=m.rowR+0.5,`${c.name} ${theme}: card ${i} (${b.l.toFixed(0)}-${b.r.toFixed(0)}) outside its row (${m.rowL.toFixed(0)}-${m.rowR.toFixed(0)})`);
   assert.ok(m.scroll<=m.client+1,`${c.name} ${theme}: theme row overflows itself (${m.scroll} > ${m.client})`);
   if(c.viewport.width<=414)assert.ok(m.doc<=m.vw,`${c.name} ${theme}: page scrolls sideways`);
   assert.deepEqual(errors,[]);
   if(shots){await page.locator('.theme-choice').scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/theme-630-${c.name}-${theme}.png`});}
   await ctx.close();
  }
  console.log('PASS theme cards (#630): all three fit their row at 375/414 px with a phone UA and in the phone layout preview, light and dark.');
 }finally{await browser.close();server.kill('SIGKILL');fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
