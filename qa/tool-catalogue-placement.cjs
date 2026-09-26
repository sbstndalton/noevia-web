// #353: the composer's Tools catalogue must open fully inside the viewport from an empty new
// chat, at widths where the trigger sits close to the top. Real server, synthetic account, no
// project, no model. Screenshots at 1440x900 and 1440x700.
// Run: PLAYWRIGHT_MODULE=<playwright-core> QA_SCREENSHOTS=<dir> node qa/tool-catalogue-placement.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {withLocale}=require('./qa-locale.cjs');
const port=31437,origin=`http://localhost:${port}`,web=path.resolve(__dirname,'..'),shots=process.env.QA_SCREENSHOTS||'/tmp';

(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-catalogue-qa-'));
 fs.mkdirSync(shots,{recursive:true});
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:String(port),UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',
  INFERENCE_BASE_URL:'http://127.0.0.1:1/v1',MODEL_MANAGER_KIND:'none',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const errors=[];
 const cookies=new Map();
 const api=async(url,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});for(const v of r.headers.getSetCookie()){const p=v.split(';')[0],i=p.indexOf('=');cookies.set(p.slice(0,i),p.slice(i+1));}return {status:r.status,body:await r.json().catch(()=>null)};};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal((await api('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'catalogueqa',displayName:'Synthetic Catalogue QA',password:'synthetic catalogue qa password',diaryEnabled:false})).status,201);
  assert.ok((await api('/api/profile/onboarding',{})).status<300);
  for(const height of [900,700]){
   const width=1440;
   const ctx=await browser.newContext(withLocale({viewport:{width,height}}));
   await ctx.addCookies([...cookies].map(([name,value])=>({name,value,url:origin})));
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin);
   // A fresh browser with no stored place opens an unsaved, empty New chat (see new-chat-landing.cjs).
   await page.getByRole('textbox',{name:'Message',exact:true}).waitFor({timeout:15000});
   assert.equal(await page.locator('.chat-workspace.is-empty').count(),1,'must be an empty new chat, not a saved one');
   await page.getByRole('button',{name:/^Tools/}).click();
   const panel=page.getByRole('dialog',{name:'Tool catalogue'});await panel.waitFor({timeout:10000});
   await page.getByRole('combobox').waitFor();
   const box=await panel.boundingBox();
   assert.ok(box,'catalogue panel must have a layout box');
   assert.ok(box.y>=0,`panel top (${box.y}) must not be above the viewport at ${width}x${height}`);
   assert.ok(box.y+box.height<=height,`panel bottom (${box.y+box.height}) must not exceed the viewport height ${height}`);
   const search=await page.getByRole('combobox').boundingBox();
   assert.ok(search&&search.y>=0&&search.y+search.height<=height,'search box must be fully visible');
   await page.screenshot({path:`${shots}/tool-catalogue-${width}-${height}.png`});
   await ctx.close();
  }
  assert.deepEqual(errors,[]);
  console.log('tool catalogue placement QA passed; screenshots in',shots);
 }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exit(1);});
