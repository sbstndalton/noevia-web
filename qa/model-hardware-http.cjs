// Actual authenticated handler against a synthetic inference endpoint; no live settings or models.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-hardware-http-')),origin='http://127.0.0.1:31322';
let available=true,hardwareCalls=0;
const manager=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/v1/system-info'){
 hardwareCalls++;assert.equal(req.method,'GET');
 if(!available){res.statusCode=503;return res.end('{}');}
 return res.end(JSON.stringify({'Physical Memory':'32 GB',cloud:{secret:'PRIVATE_CANARY'},model_storage:{path:'/private/canary'},devices:{cpu:{name:'Synthetic CPU'},amd_gpu:[{name:'Synthetic GPU',available:true,vram_gb:2,virtual_mem_gb:16}]}}));
 }
 return res.end(JSON.stringify({data:[]}));
});
function client(){const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{
 const r=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});
 for(const value of r.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
 const text=await r.text();return{status:r.status,text,body:JSON.parse(text)};
};}
(async()=>{
 await new Promise(r=>manager.listen(0,'127.0.0.1',r));const inference=`http://127.0.0.1:${manager.address().port}`;
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31322',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:inference,INFERENCE_API_KEY:'synthetic',MODEL_MANAGER_KIND:'lemonade',MODEL_MANAGER_BASE_URL:inference,MODEL_MANAGER_API_KEY:'synthetic',DIARY_BASE_URL:'http://127.0.0.1:9',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 try{
 const admin=client();for(let i=0;i<100;i++){try{if((await admin('/api/setup/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.equal((await admin('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'hardwareadmin',displayName:'Synthetic Hardware Admin',password:'synthetic hardware administrator password',diaryEnabled:false})).status,201);
 assert.equal((await client()('/api/models/hardware')).status,401);
 const r=await admin('/api/models/hardware');assert.equal(r.status,200,r.text);assert.equal(r.body.systemGB,32);assert.equal(r.body.gpus[0].capacityGB,2);assert.equal(r.body.gpus[0].sharedGB,16);assert.ok(!r.text.includes('PRIVATE_CANARY'));assert.ok(!r.text.includes('/private/'));
 assert.equal((await admin('/api/models/hardware',{})).status,405);
 available=false;assert.equal((await admin('/api/models/hardware')).status,502);available=true;assert.equal((await admin('/api/models/hardware')).status,200);assert.equal(hardwareCalls,3);
 console.log('PASS real HTTP hardware auth/method/read-only/allowlist/failure/retry');
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>manager.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
