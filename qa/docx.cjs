const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process'),{once}=require('node:events');
const web=path.resolve(__dirname,'..'),workerDir=path.resolve(web,'../../services/ocr'),origin='http://localhost:31246';
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-docx-')),requests=[];
 const fixture=spawnSync('python3',['-c','from test_docx import fixture; import sys; sys.stdout.buffer.write(fixture("<w:p><w:r><w:t>SYNTHETIC REFUND -7.20</w:t></w:r></w:p>"))'],{cwd:workerDir});if(fixture.status!==0)throw Error('Fixture generation failed');
 const worker=spawn('python3',['-c','from server import Handler,ThreadingHTTPServer; ThreadingHTTPServer(("127.0.0.1",31245),Handler).serve_forever()'],{cwd:workerDir,stdio:'ignore'});
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;if(req.url.endsWith('/models')){res.setHeader('Content-Type','application/json');return res.end('{"data":[{"id":"synthetic-model"}]}');}requests.push(JSON.parse(raw));res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'Synthetic document answer'}}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>upstream.listen(31247,'127.0.0.1',r));
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31246',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic',INFERENCE_BASE_URL:'http://127.0.0.1:31247/v1',DIARY_BASE_URL:'http://127.0.0.1:1',OCR_BASE_URL:'http://127.0.0.1:31245',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/setup/status')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const page=await browser.newPage();await page.goto(origin);
  assert.equal((await api(page,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'docxqa',displayName:'Synthetic DOCX QA',password:'synthetic document password',diaryEnabled:false})).status,201);
  await api(page,'/api/profile/onboarding',{});
  const project=(await api(page,'/api/projects',{name:'Synthetic DOCX',model:'synthetic-model',toolboxes:[]})).body;
  await page.reload();await page.getByText('Synthetic DOCX',{exact:true}).first().click();await page.getByRole('tab',{name:'Sources',exact:true}).click();
  await page.getByLabel('Upload files',{exact:true}).setInputFiles({name:'fixture.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:fixture.stdout});
  await page.locator('.source-status').filter({hasText:'DOCX body text and tables only'}).first().waitFor();
  const readProject=async()=> (await api(page,'/api/workspace')).body.projects.find(p=>p.id===project.id);
  let file=(await readProject()).files[0];assert.equal(file.attachment.state,'partial');assert.ok(file.content.includes('SYNTHETIC REFUND -7.20'));
  const original=await page.evaluate(async id=>Array.from(new Uint8Array(await (await fetch('/api/projects/'+id+'/uploads/original?name=fixture.docx')).arrayBuffer())),project.id);assert.deepEqual(Buffer.from(original),fixture.stdout);
  for(const theme of ['light','dark'])for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(process.env.QA_SCREENSHOTS)await page.screenshot({path:`${process.env.QA_SCREENSHOTS}/docx-${theme}-${width}.png`,fullPage:true,animations:'disabled'});}
  await page.getByRole('tab',{name:'Chats',exact:true}).click();await page.locator('.composer-input').fill('Read the synthetic refund');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Synthetic document answer',{exact:true}).waitFor();
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('SYNTHETIC REFUND -7.20'));assert.ok(JSON.stringify(requests.at(-1).messages).includes('footnotes are not interpreted'));
  assert.equal((await api(page,'/api/projects/'+project.id+'/upload',{organized:true,name:'fixture.docx',dataBase64:Buffer.from('corrupt replacement').toString('base64')})).status,200);
  file=(await readProject()).files[0];assert.equal(file.content,'');assert.equal(file.attachment.state,'stored');assert.match(file.attachment.reason,/could not be read/);
  console.log('PASS actual DOCX worker + unified browser upload, original download, labelled partial text in model context, malformed replacement and responsive source rows');
 }finally{await browser.close();server.kill('SIGTERM');worker.kill('SIGTERM');await Promise.all([once(server,'exit'),once(worker,'exit')]);await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
