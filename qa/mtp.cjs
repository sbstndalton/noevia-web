// Real isolated noevia server and synthetic Lemonade; no production model loads.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31255',web=path.resolve(__dirname,'..');
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-mtp-')),loads=[];
 let fail=false,options={ctx_size:32768,llamacpp_backend:'vulkan',llamacpp_args:'--cache-type-k q5_0 --tensor-split 1,1 --spec-type none'};
 const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(req.url.endsWith('/models'))return json({data:[{id:'Synthetic native',recipe:'llamacpp',labels:['mtp'],recipe_options:options},{id:'Unsupported',recipe:'llamacpp',labels:[]}]});
  if(req.url.endsWith('/health'))return json({status:'ok',all_models_loaded:[{model_name:'Synthetic native',loaded:true,type:'llm',recipe_options:options}]});
  if(req.url==='/metrics'){res.setHeader('Content-Type','text/plain');return res.end('lemonade_llamacpp_spec_decode_num_draft_tokens_total{model_name="Synthetic native"} 100\nlemonade_llamacpp_spec_decode_num_accepted_tokens_total{model_name="Synthetic native"} 75\n');}
  if(req.url.endsWith('/load')){loads.push(body);if(fail){res.statusCode=503;return json({error:'Synthetic load failure'});}if(body.save_options){const {model_name,save_options,...saved}=body;options=saved;}return json({status:'success'});}
  if(req.url.endsWith('/stats'))return json({tokens_per_second:30,output_tokens:300});
  return json({});
 });await new Promise(r=>upstream.listen(31256,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31255',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:31256/v1',MODEL_MANAGER_KIND:'lemonade',MODEL_MANAGER_BASE_URL:'http://127.0.0.1:31256',DIARY_BASE_URL:'http://127.0.0.1:1',DIARY_AUTH_TOKEN:'synthetic-only',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const page=await browser.newPage();await page.goto(origin);
  assert.equal((await api(page,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic mtp password',diaryEnabled:true})).status,201);
  await api(page,'/api/profile/onboarding',{});await page.reload();
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
  await page.getByRole('button',{name:/Choose model:/}).click();await page.getByRole('button',{name:'Manage',exact:true}).click();
  const control=page.getByRole('combobox',{name:'Enable MTP for Synthetic native',exact:true});await control.waitFor();
  await page.waitForFunction(()=>!document.querySelector('select[aria-label="Enable MTP for Synthetic native"]').disabled);
  await control.selectOption('yes');await page.getByRole('button',{name:'Apply and load',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('select[aria-label="Enable MTP for Synthetic native"]').disabled);
  assert.equal(loads.length,2);assert.equal(loads[0].save_options,undefined);assert.equal(loads[1].save_options,true);assert.equal(loads[0].ctx_size,32768);assert.match(loads[0].llamacpp_args,/--tensor-split 1,1/);assert.match(loads[0].llamacpp_args,/--spec-type draft-mtp/);
  assert.equal(await page.getByRole('combobox',{name:'Enable MTP for Unsupported',exact:true}).isDisabled(),true);
  await page.getByTitle('Close',{exact:true}).click();
  await page.getByRole('progressbar',{name:'MTP acceptance for Synthetic native'}).waitFor();assert.equal(await page.getByRole('progressbar').getAttribute('value'),'0.75');
  for(const diary of [false,true]){
   if(diary)await page.getByRole('button',{name:'Diary',exact:true}).click();
   for(const width of [375,768,1440]){await page.setViewportSize({width,height:950});const footer=page.getByRole('region',{name:'Inference details'});assert.equal(await footer.isVisible(),true);assert.equal(await footer.locator('summary').count(),0);assert.ok(await footer.evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/mtp-${diary}-${width}.png`});}
  }
  assert.equal((await api(page,'/api/models/load',{name:'Synthetic native',mtp:false})).status,200);assert.match(options.llamacpp_args,/--spec-type none$/);
  const saved=JSON.stringify(options),before=loads.length;fail=true;
  assert.equal((await api(page,'/api/models/load',{name:'Synthetic native',mtp:true})).status,502);assert.equal(loads.length,before+1);assert.equal(JSON.stringify(options),saved);fail=false;
  assert.equal((await api(page,'/api/models/load',{name:'Unsupported',mtp:true})).status,400);
  assert.equal((await api(page,'/api/models/load',{name:'Synthetic native',mtp:'yes'})).status,400);
  const invite=await api(page,'/api/admin/invitations',{role:'member'}),member=await browser.newPage();await member.goto(origin);
  assert.equal((await api(member,'/api/auth/invitations/accept',{token:invite.body.token,username:'memberqa',displayName:'Member',password:'synthetic member password',diaryEnabled:false})).status,201);
  assert.equal((await api(member,'/api/models/load',{name:'Synthetic native',mtp:true})).status,403);
  console.log('PASS MTP selector, pre-load flag/options preservation, post-success persistence, failed-load safety, unsupported/member rejection and always-visible Chat/Diary acceptance bar');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
