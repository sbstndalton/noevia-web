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
  function seed(id,input,output,unknown=0){const file=path.join(dir,'users',id,'usage.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({days:{[day]:{input:input+unknown,output,replies:2,prompt:'PRIVATE_CANARY_NOT_METRICS',models:{known:{input,output,replies:1},...(unknown?{unknown:{input:unknown,output:0,replies:1}}:{})}}}}));}
  seed(adminId,1000000,500000);seed(other.id,2000000,1000000,100);
  const pricing={currency:'USD',rates:[{model:'known',inputPerMillion:2,outputPerMillion:4}]};
  assert.equal((await other.api('/api/usage/rates',pricing,'PUT')).status,403);
  assert.equal((await other.api('/api/usage/aggregate')).status,403);
  assert.equal((await client()('/api/usage/aggregate')).status,401);
  assert.equal((await admin('/api/usage/rates',pricing,'PUT')).status,200);
  r=await other.api('/api/usage?userId='+adminId);assert.equal(r.body.last7.input,2000100);assert.equal(r.body.costs.last7.amount,null);assert.equal(r.body.costs.last7.pricedSubtotal,8);assert.ok(!r.text.includes('PRIVATE_CANARY'));
  r=await admin('/api/usage');assert.equal(r.body.last7.input,1000000);assert.equal(r.body.costs.last7.amount,4);
  r=await admin('/api/usage/aggregate');assert.equal(r.status,200,r.text);assert.equal(r.body.last7.input,3000100);assert.equal(r.body.aggregate.accounts,2);assert.equal(r.body.costs.last7.pricedSubtotal,12);assert.equal(r.body.costs.last7.amount,null);assert.ok(!r.text.includes('PRIVATE_CANARY'));
  assert.equal((await admin('/api/usage/rates',{...pricing,rates:[...pricing.rates,...pricing.rates]},'PUT')).status,400);
  assert.deepEqual((await admin('/api/usage/rates')).body.rates,pricing.rates);
  const broken=await member('usagebroken');const badFile=path.join(dir,'users',broken.id,'usage.json');fs.mkdirSync(path.dirname(badFile),{recursive:true});fs.writeFileSync(badFile,'bad json');
  r=await admin('/api/usage/aggregate');assert.equal(r.body.aggregate.accounts,3);assert.equal(r.body.aggregate.unreadableAccounts,1);
  console.log('PASS: real HTTP per-user isolation, admin-only totals/pricing, exact cost math, unknown-price coverage, malformed-account reporting, invalid-rate preservation and no private fields.');
  if(process.env.KEEP_QA==='1'){console.log('Browser fixture '+origin+' — usageadmin / synthetic usage administrator password');await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});}
 }finally{server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
