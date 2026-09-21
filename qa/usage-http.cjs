// Real web/auth routes against disposable synthetic usage. No inference requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const origin='http://localhost:31281',dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-usage-http-'));
function client(){const cookies=new Map();return async(url,body,method=body===undefined?'GET':'POST')=>{
 const response=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':decodeURIComponent(cookies.get('cowork_csrf')||'')},body:body===undefined?undefined:JSON.stringify(body)});
 for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}
 const text=await response.text();let value;try{value=JSON.parse(text);}catch{}return{status:response.status,text,body:value};
};}
(async()=>{
 const server=spawn(process.execPath,['server/index.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',env:{...process.env,UI_DATA_DIR:dir,UI_PORT:'31281',UI_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,LEGACY_AUTH_COMPAT:'false',INFERENCE_BASE_URL:'http://127.0.0.1:9',MODEL_MANAGER_KIND:'none',MCP_SERVERS:'',MCP_SERVER_URL:''}});
 try{
  const admin=client();for(let i=0;i<100;i++){try{if((await admin('/api/setup/status')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  let r=await admin('/api/setup/complete',{setupCode:fs.readFileSync(path.join(dir,'first-run-setup-code'),'utf8').trim(),publicOrigin:origin,username:'usageadmin',displayName:'Synthetic Usage Admin',password:'synthetic usage administrator password',diaryEnabled:false});assert.equal(r.status,201,r.text);
  await admin('/api/profile/onboarding',{});
  const adminId=(await admin('/api/profile')).body.user.id;
  async function member(username){const invite=await admin('/api/admin/invitations',{role:'member'}),api=client();const result=await api('/api/auth/invitations/accept',{token:invite.body.token,username,displayName:'Synthetic member',password:'synthetic usage member password',diaryEnabled:false});assert.ok(result.status<300,result.text);return{api,id:(await api('/api/profile')).body.user.id};}
  const other=await member('usagemember');
  const d=new Date(),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function seed(id,input,output,unknown=0,extra={}){const file=path.join(dir,'users',id,'usage.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({days:{[day]:{input:input+unknown,output,replies:2,prompt:'PRIVATE_CANARY_NOT_METRICS',models:{known:{input,output,replies:1},...(unknown?{unknown:{input:unknown,output:0,replies:1}}:{})},...extra}}}));}
  seed(adminId,1000000,500000,0,{tools:{read_project_file:3},hours:{9:2}});seed(other.id,2000000,1000000,100,{tools:{read_project_file:1,nc_notes_search:4},hours:{9:1,21:1}});
  assert.equal((await other.api('/api/usage/aggregate')).status,403);
  assert.equal((await client()('/api/usage/aggregate')).status,401);
  // Cost estimation was removed along with its rates endpoint.
  assert.equal((await admin('/api/usage/rates',{currency:'USD',rates:[]},'PUT')).status,404);
  r=await other.api('/api/usage?userId='+adminId);assert.equal(r.body.last7.input,2000100);assert.ok(!('costs' in r.body));assert.ok(!r.text.includes('PRIVATE_CANARY'));
  r=await admin('/api/usage');assert.equal(r.body.last7.input,1000000);assert.ok(!('costs' in r.body));
  // Tool calls and peak hour come from the same per-day file, per account.
  assert.deepEqual(r.body.tools,[{name:'read_project_file',calls:3}]);assert.deepEqual(r.body.peakHour,{hour:9,replies:2});
  r=await admin('/api/usage/aggregate');assert.equal(r.status,200,r.text);assert.equal(r.body.last7.input,3000100);
  assert.deepEqual(r.body.tools,[{name:'nc_notes_search',calls:4},{name:'read_project_file',calls:4}]); // equal counts sort by nameassert.deepEqual(r.body.peakHour,{hour:9,replies:3});assert.equal(r.body.aggregate.accounts,2);assert.ok(!('costs' in r.body));assert.ok(!r.text.includes('PRIVATE_CANARY'));
  const broken=await member('usagebroken');const badFile=path.join(dir,'users',broken.id,'usage.json');fs.mkdirSync(path.dirname(badFile),{recursive:true});fs.writeFileSync(badFile,'bad json');
  r=await admin('/api/usage/aggregate');assert.equal(r.body.aggregate.accounts,3);assert.equal(r.body.aggregate.unreadableAccounts,1);
  console.log('PASS: real HTTP per-user isolation, admin-only aggregate totals, per-account and aggregated tool calls and peak hour, no cost estimation anywhere, malformed-account reporting and no private fields.');
  if(process.env.KEEP_QA==='1'){console.log('Browser fixture '+origin+' — usageadmin / synthetic usage administrator password');await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
