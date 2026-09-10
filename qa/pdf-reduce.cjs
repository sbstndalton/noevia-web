// Disposable real application server plus a synthetic completion endpoint.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31257',web=path.resolve(__dirname,'..');
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};
 },{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-pdf-'));let mode='text',calls=0;
 const upstream=http.createServer(async(req,res)=>{
  let size=0;for await(const c of req)size+=c.length;
  if(req.url!='/reduce-pdf'){res.statusCode=404;return res.end('{}');}
  calls++;assert.ok(size>25*1024*1024);res.setHeader('Content-Type','application/json');
  if(mode==='fail'){res.statusCode=422;return res.end('{}');}
  res.end(JSON.stringify(mode==='text'?{kind:'text',text:'Synthetic PDF text recovered.'}:{kind:'pdf',dataBase64:fs.readFileSync(path.join(web,'server/fixtures/documents/text.pdf')).toString('base64')}));
 });await new Promise(r=>upstream.listen(31258,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31257',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1/v1',DIARY_BASE_URL:'http://127.0.0.1:1',OCR_BASE_URL:'http://127.0.0.1:31258',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const page=await browser.newPage();await page.goto(origin);
  assert.equal((await api(page,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'adminqa',displayName:'Synthetic admin',password:'synthetic pdf password',diaryEnabled:false})).status,201);
  await api(page,'/api/profile/onboarding',{});
  const project=(await api(page,'/api/projects',{name:'Synthetic PDFs',model:'synthetic',toolboxes:[]})).body;
  await page.reload();await page.getByText('Synthetic PDFs',{exact:true}).first().click();
  const bytes=Buffer.alloc(26*1024*1024,32);bytes.write('%PDF-1.7');
  await page.locator('input[type=file]').first().setInputFiles({name:'oversized.pdf',mimeType:'application/pdf',buffer:bytes});
  await page.getByText(/Text-only extraction; images/).first().waitFor();
  let saved=(await api(page,'/api/workspace')).body.projects.find(p=>p.id===project.id);
  assert.ok(saved.files.some(f=>f.name==='oversized.extracted.txt'&&f.content.includes('Synthetic PDF text')));assert.equal(calls,1);
  const upload=async name=>{
   const posted=await api(page,'/api/projects/'+project.id+'/upload?background=1',{name,dataBase64:bytes.toString('base64'),organized:true});assert.equal(posted.status,202);
   for(let i=0;i<120;i++){const j=(await api(page,posted.body.poll)).body;if(j.done)return j;await new Promise(r=>setTimeout(r,100));}throw Error('job did not complete');
  };
  mode='pdf';const compressed=await upload('other.pdf');assert.equal(compressed.status,200);assert.equal(compressed.body.name,'other.compressed.pdf');
  mode='fail';const failed=await upload('failure.pdf');assert.equal(failed.status,422);
  saved=(await api(page,'/api/workspace')).body.projects.find(p=>p.id===project.id);assert.equal(saved.files.length,2);
  for(const theme of ['light','dark'])for(const width of [375,768,1440]){await page.setViewportSize({width,height:950});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  console.log('PASS oversized PDF UI upload, text notice, compressed derivative, failure preserves sources and responsive layout');
 }finally{await browser.close();server.kill('SIGTERM');await once(server,'exit');await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
