// DAV interoperability (docs/dav.md, "Interoperability matrix"): a real client (rclone) against the
// real web server AND the real Diary companion, on a throwaway tenant in a temp folder. Nothing
// here reaches DaServer or any real Diary. Needs services/diary/.venv (the companion's deps).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const origin='http://localhost:31259',dav='http://localhost:31260',companionUrl='http://127.0.0.1:31261';
const web=path.resolve(__dirname,'..'),diary=path.resolve(web,'../../services/diary');
const wait=async(url,headers={})=>{for(let i=0;i<200;i++){try{if((await fetch(url,{headers})).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('not up: '+url);};
async function api(page,url,body,method=body===undefined?'GET':'POST'){
 return page.evaluate(async({url,body,method})=>{
  const csrf=decodeURIComponent(document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('cowork_csrf='))?.slice(12)||'');
  const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null)};
 },{url,body,method});
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-dav-interop-')),results=[];
 const log=fs.openSync(path.join(dir,'companion.log'),'a');
 const companion=spawn(path.join(diary,'.venv/bin/python'),['-m','uvicorn','agent.app:app','--host','127.0.0.1','--port','31261'],{cwd:diary,stdio:['ignore',log,log],env:{...process.env,
  DIARY_AUTH_TOKEN:'synthetic-only',DB_PATH:path.join(dir,'diary','index.db'),CORPUS_BACKEND:'local',CORPUS_LOCAL_ROOT:path.join(dir,'legacy-corpus'),
  LLM_BASE_URL:'http://127.0.0.1:1',LLM_AUX_BASE_URL:'http://127.0.0.1:1',DIARY_INDEX_ENABLED:'true'}});
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:web,stdio:'ignore',env:{...process.env,UI_DATA_DIR:path.join(dir,'web'),UI_PORT:'31259',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',DIARY_AUTH_TOKEN:'synthetic-only',INFERENCE_BASE_URL:'http://127.0.0.1:1',DIARY_BASE_URL:companionUrl,MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:'',COWORK_DAV_PORT:'31260',COWORK_DAV_SCOPE:'lan',COWORK_DAV_ORIGIN:dav}});
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
  Object.assign(rcloneEnv,{RCLONE_CONFIG_NV_TYPE:'webdav',RCLONE_CONFIG_NV_URL:`${dav}/dav/interop/`,RCLONE_CONFIG_NV_VENDOR:'other',RCLONE_CONFIG_NV_USER:'interop',RCLONE_CONFIG_NV_PASS:execFileSync('rclone',['obscure',credential.password],{encoding:'utf8'}).trim()});
  const local=path.join(dir,'local');fs.mkdirSync(path.join(local,'sub'),{recursive:true});
  fs.writeFileSync(path.join(local,'a.md'),'# A\n');fs.writeFileSync(path.join(local,'sub','b.md'),'# B\n');
  step('rclone lsf (PROPFIND)',true,rclone('lsf','nv:'));
  step('rclone copyto new file (PUT)',true,rclone('copyto',path.join(local,'a.md'),'nv:a.md'));
  step('rclone mkdir (MKCOL)',true,rclone('mkdir','nv:work'));
  step('rclone copyto into folder',true,rclone('copyto',path.join(local,'a.md'),'nv:work/a.md'));
  step('rclone moveto rename (MOVE)',true,rclone('moveto','nv:a.md','nv:renamed.md'));
  step('rclone copyto server-side (COPY)',true,rclone('copyto','nv:renamed.md','nv:copied.md'));
  step('rclone cat round-trip',true,(r=>({ok:r.ok&&r.out==='# A\n',out:r.out}))(rclone('cat','nv:copied.md')));
  step('rclone deletefile (DELETE to Trash)',true,rclone('deletefile','nv:copied.md'));
  step('rclone sync folder',true,rclone('sync',local,'nv:synced'));
  step('rclone purge folder (DELETE folder)',true,rclone('purge','nv:work'));
  // Overwrite an existing file the way rclone does (no If-Match): its previous bytes land in Trash.
  fs.writeFileSync(path.join(local,'notes.md'),'# Notes, edited by rclone\n');
  step('rclone copyto overwrite (unconditional PUT)',true,rclone('copyto',path.join(local,'notes.md'),'nv:notes.md'));
  const trash=(await api(admin,'/api/diary/workspace-trash')).body?.records||[];
  results.push({name:'overwritten version kept in Trash',pass:trash.some(r=>/^notes \(replaced .*\)\.md$/.test(r.path)),detail:trash.map(r=>r.path).join(', ')});
  fs.writeFileSync(path.join(local,'INDEX.md'),'# clobbered\n');
  step('rclone overwrite protected INDEX.md refused',false,rclone('copyto','--retries','1',path.join(local,'INDEX.md'),'nv:INDEX.md'));
  step('rclone deletefile protected INDEX.md refused',false,rclone('deletefile','nv:INDEX.md'));
  step('rclone moveto protected INDEX.md refused',false,rclone('moveto','nv:INDEX.md','nv:moved-index.md'));
  const indexAfter=await (await fetch(`${dav}/dav/interop/INDEX.md`,{headers:auth})).text();
  results.push({name:'protected index byte-identical',pass:indexBefore===indexAfter,detail:''});
  const listing=rclone('lsf','-R','nv:');results.push({name:'final tree',pass:true,detail:listing.out.trim().split('\n').join(', ')});
 }finally{
  await browser.close();server.kill('SIGTERM');companion.kill('SIGTERM');await Promise.all([once(server,'exit'),once(companion,'exit')]).catch(()=>{});
  const version=(()=>{try{return execFileSync('rclone',['version'],{encoding:'utf8'}).split('\n')[0];}catch{return 'rclone ?';}})();
  console.log(`DAV interop with ${version}`);for(const r of results)console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.detail?'  — '+r.detail:''}`);
  if(results.some(r=>!r.pass)){process.exitCode=1;console.log('companion log: '+path.join(dir,'companion.log'));}else fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
