// Diary storage fields are locked until the saved connection loads. If it never loads, the form
// must say why and offer Try again, rather than greying out silently (seen 2026-09-18).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const PORT=31386,origin=`http://localhost:${PORT}`,web=path.resolve(__dirname,'..');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-storage-qa-'));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:data,UI_PORT:String(PORT),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',MODEL_MANAGER_KIND:'none',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<200;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const setupCode=fs.readFileSync(path.join(data,'first-run-setup-code'),'utf8').trim();
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(origin);
  await page.evaluate(async(b)=>{await fetch('/api/setup/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});},{setupCode,publicOrigin:origin,username:'storeqa',displayName:'Storage QA',password:'synthetic password QA',diaryEnabled:true});
  let hang=true;
  await page.route('**/api/integrations/storage',async(route)=>{if(hang&&route.request().method()==='GET')return; await route.continue();});
  await page.reload();
  await page.getByRole('heading',{name:'Connect an inference provider'}).waitFor();
  await page.getByRole('button',{name:'Skip — set up later in Settings',exact:true}).click();
  await page.getByRole('button',{name:'Connect storage I already run'}).click();
  await page.getByText('Loading your saved storage connection…').waitFor();
  const alert=page.getByText(/couldn’t be loaded, so these fields are locked/);
  await alert.waitFor({timeout:15000});
  assert.ok(await page.getByPlaceholder('https://cloud.example.com').isDisabled(),'still locked while unknown');
  hang=false;
  await page.getByRole('button',{name:'Try again'}).click();
  await alert.waitFor({state:'detached'});
  await page.getByPlaceholder('https://cloud.example.com').fill('https://cloud.test');
  console.log('PASS storage load: locked fields say why after 10 s, Try again loads the saved connection and unlocks them.');
 }finally{await browser.close();server.kill('SIGKILL');fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
