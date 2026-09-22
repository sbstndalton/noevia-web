// DAV interoperability, Obsidian sync: the `webdav` npm client that Remotely Save is built on
// (WEBDAV_MODULE=path to webdav/dist/node/index.js, v5), making Remotely Save's calls, against the
// real web server AND the real Diary companion, on a throwaway tenant in a temp folder. Nothing
// here reaches DaServer or any real Diary. Needs services/diary/.venv (the companion's deps).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31279',dav='http://localhost:31280',companionUrl='http://127.0.0.1:31281';
const web=path.resolve(__dirname,'..'),diary=path.resolve(web,'../../services/diary');
const wait=async(url,headers={})=>{for(let i=0;i<200;i++){try{if((await fetch(url,{headers})).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('not up: '+url);};
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};
 },{url,body,method});
}
(async()=>{
 if(!process.env.WEBDAV_MODULE)throw Error('Set WEBDAV_MODULE to webdav/dist/node/index.js (opt-in suite).');
 const {createClient}=await import(process.env.WEBDAV_MODULE);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-dav-interop-')),results=[];
 const log=fs.openSync(path.join(dir,'companion.log'),'a');
 const companion=spawn(path.join(diary,'.venv/bin/python'),['-m','uvicorn','agent.app:app','--host','127.0.0.1','--port','31281'],{cwd:diary,stdio:['ignore',log,log],env:{...process.env,
  DIARY_AUTH_TOKEN:'synthetic-only',DB_PATH:path.join(dir,'diary','index.db'),CORPUS_BACKEND:'local',CORPUS_LOCAL_ROOT:path.join(dir,'legacy-corpus'),
  LLM_BASE_URL:'http://127.0.0.1:1',LLM_AUX_BASE_URL:'http://127.0.0.1:1',DIARY_INDEX_ENABLED:'true'}});
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:path.join(dir,'web'),UI_PORT:'31279',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:companionUrl,MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:'',COWORK_DAV_PORT:'31280',COWORK_DAV_SCOPE:'lan',COWORK_DAV_ORIGIN:dav}});
 fs.mkdirSync(path.join(dir,'web'),{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const rcloneEnv={};
 const rclone=(...args)=>{try{return {ok:true,out:execFileSync('rclone',args,{env:{...process.env,...rcloneEnv},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000})};}catch(e){return {ok:false,out:String(e.stderr||e.message)};}};
 const step=(name,expectOk,r)=>{const pass=r.ok===expectOk;results.push({name,pass,detail:pass?'':r.out.split('\n').filter(Boolean).slice(-2).join(' | ')});};
 try{
  await wait(companionUrl+'/api/health',{Authorization:'Bearer synthetic-only'});await wait(origin+'/api/setup/status');
  const admin=await browser.newPage();await admin.goto(origin);
  const setup=await api(admin,'/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'web','first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'interop',displayName:'Synthetic interop',password:'synthetic password interop',diaryEnabled:true});assert.equal(setup.status,201,JSON.stringify(setup.body));
  await api(admin,'/api/profile/onboarding',{});
  assert.equal((await api(admin,'/api/profile/sharing',{scope:'lan',acknowledgeCleartext:true},'PUT')).status,200);
  const credential=(await api(admin,'/api/profile/app-passwords',{name:'rclone interop',scope:'lan'})).body;
  const auth={Authorization:'Basic '+Buffer.from('interop:'+credential.password).toString('base64')};
  // Seed through the web DAV PUT (the supported write path), including the protected index.
  for(const [p,body] of [['notes.md','# Notes\n'],['INDEX.md','# Index\n']]){const r=await fetch(`${dav}/dav/interop/${p}`,{method:'PUT',headers:{...auth,'If-None-Match':'*'},body});assert.ok([201,204].includes(r.status),p+' seed '+r.status);}
  const indexBefore=await (await fetch(`${dav}/dav/interop/INDEX.md`,{headers:auth})).text();
  const opts=await fetch(`${dav}/dav/interop/`,{method:'OPTIONS',headers:auth});
  results.push({name:'OPTIONS advertises DAV: 1',pass:opts.headers.get('dav')==='1',detail:`DAV=${opts.headers.get('dav')} Allow=${opts.headers.get('allow')}`});
  const client=createClient(`${dav}/dav/interop/`,{username:'interop',password:credential.password,headers:{'Cache-Control':'no-cache'}});
  const step=async(name,fn,expectOk=true)=>{try{const out=await fn();results.push({name,pass:expectOk,detail:expectOk?(out===undefined?'':String(out).slice(0,120)):'accepted but should have been refused'});}catch(e){results.push({name,pass:!expectOk,detail:expectOk?String(e.status||'')+' '+String(e.message).slice(0,120):`refused (${e.status||e.message})`});}};
  const text=async(p)=>Buffer.from(await client.getFileContents(p)).toString('utf8');
  await step('getDAVCompliance (strategy probe)',async()=>{const c=await client.getDAVCompliance('/');return `compliance=${c.compliance.join(',')} server=${c.server||'?'}`;});
  // Remotely Save lists the vault with Depth: infinity and falls back to one level at a time.
  let deep=null;
  await step('list vault, Depth: infinity or one-level fallback',async()=>{
   try{deep=await client.getDirectoryContents('/',{deep:true});return `infinity: ${deep.length} entries`;}
   catch(e){const flat=await client.getDirectoryContents('/',{deep:false});return `infinity refused (${e.status}); one level: ${flat.length} entries`;}
  });
  await step('putFileContents new note (overwrite:true)',()=>client.putFileContents('/Obsidian note.md','# From Obsidian\n',{overwrite:true}));
  await step('read it back',async()=>{const t=await text('/Obsidian note.md');if(t!=='# From Obsidian\n')throw Error(JSON.stringify(t));return 'ok';});
  await step('stat',async()=>{const s=await client.stat('/Obsidian note.md');if(s.type!=='file'||!s.lastmod)throw Error(JSON.stringify(s));return `size=${s.size} lastmod=${s.lastmod}`;});
  await step('createDirectory (non-recursive)',()=>client.createDirectory('/Daily'));
  await step('put into folder',()=>client.putFileContents('/Daily/2026-09-22.md','# Today\n',{overwrite:true}));
  await step('moveFile (rename)',()=>client.moveFile('/Obsidian note.md','/Renamed note.md'));
  await step('overwrite an existing note (unconditional PUT)',()=>client.putFileContents('/notes.md','# Notes, edited in Obsidian\n',{overwrite:true}));
  const trash=(await api(admin,'/api/diary/workspace-trash')).body?.records||[];
  results.push({name:'overwritten version kept in Trash',pass:trash.some(r=>/^notes \(replaced .*\)\.md$/.test(r.path)),detail:trash.map(r=>r.path).join(', ')});
  await step('deleteFile (to Trash)',()=>client.deleteFile('/Renamed note.md'));
  await step('listing after changes (one level)',async()=>(await client.getDirectoryContents('/',{deep:false})).map(e=>e.basename).sort().join(', '));
  await step('overwrite protected INDEX.md refused',()=>client.putFileContents('/INDEX.md','# clobbered\n',{overwrite:true}),false);
  await step('delete protected INDEX.md refused',()=>client.deleteFile('/INDEX.md'),false);
  await step('move protected INDEX.md refused',()=>client.moveFile('/INDEX.md','/moved.md'),false);
  const indexAfter=await (await fetch(`${dav}/dav/interop/INDEX.md`,{headers:auth})).text();
  results.push({name:'protected index byte-identical',pass:indexBefore===indexAfter,detail:''});
 }finally{
  await browser.close();server.kill('SIGTERM');companion.kill('SIGTERM');await Promise.all([once(server,'exit'),once(companion,'exit')]).catch(()=>{});
  const version='webdav (npm) '+(()=>{try{return JSON.parse(fs.readFileSync(path.join(path.dirname(process.env.WEBDAV_MODULE),'../../package.json'),'utf8')).version;}catch{return '?';}})()+', Remotely Save call pattern';
  console.log(`DAV interop with ${version}`);for(const r of results)console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.detail?'  — '+r.detail:''}`);
  if(results.some(r=>!r.pass)){process.exitCode=1;console.log('companion log: '+path.join(dir,'companion.log'));}else fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
