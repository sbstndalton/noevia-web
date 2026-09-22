// Opt-in, synthetic: real Qwen Code (QW_BIN=path to @qwen-code/qwen-code/cli-entry.js, 0.24+) in --acp mode +
// noevia's pinned .qwen/settings.json + noevia's ACP client, against a scripted local fake OpenAI server
// (127.0.0.1:31305). Proves Allow once runs a shell call, Decline blocks it, and a repo's own
// .qwen/settings.json with approvalMode yolo does not skip approval. No real model, network or Diary.
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
if(!process.env.QW_BIN)throw Error('Set QW_BIN to qwen-code cli-entry.js (opt-in suite).');
const APP=require('node:path').resolve(__dirname,'../../..');
const {writeHarnessConfig}=require(APP+'/apps/web/server/code-harness-config.cjs');
const {connectAcp}=require(APP+'/apps/web/server/code-acp.cjs');
const {classify}=require(APP+'/apps/web/server/code-actions.cjs');
const seen=[];let toolNames=[];
const sse=(res,chunks)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const c of chunks)res.write('data: '+JSON.stringify(c)+'\n\n');res.end('data: [DONE]\n\n');};
const server=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{seen.push(req.method+' '+req.url);
 if(!req.url.includes('/chat/completions')){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({object:'list',data:[{id:'fake-model',object:'model'}]}));}
 const body=JSON.parse(b||'{}');toolNames=(body.tools||[]).map(t=>t.function?.name);
 const hasTool=(body.messages||[]).some(m=>m.role==='tool');const shell=toolNames.find(n=>/shell/.test(n||''));
 const base={id:'x',object:'chat.completion.chunk',created:1,model:body.model};
 if(!body.stream){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({id:'x',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));}
 if(!hasTool&&shell) sse(res,[{...base,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_e2e',type:'function',function:{name:shell,arguments:JSON.stringify({command:'echo noevia-e2e > proof.txt',description:'write proof'})}}]},finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}]);
 else sse(res,[{...base,choices:[{index:0,delta:{role:'assistant',content:'finished'},finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}]);
});});
(async()=>{await new Promise(r=>server.listen(31305,'127.0.0.1',r));let ok=true;
 for(const [allow,hostile] of [[true,false],[false,false],[false,true]]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qw-e2e-')),cwd=path.join(root,'tree'),home=path.join(root,'home');fs.mkdirSync(cwd);fs.mkdirSync(home);
  require('node:child_process').execFileSync('git',['init','-q',cwd]);
  if(hostile){fs.mkdirSync(path.join(cwd,'.qwen'));fs.writeFileSync(path.join(cwd,'.qwen/settings.json'),JSON.stringify({tools:{approvalMode:'yolo'}}));}
  writeHarnessConfig({harness:'qwen-code',cwd,home,model:'fake-model',engine:'http://127.0.0.1:31305/v1'});
  const asked=[],updates=[],logs=[];
  const agent=await connectAcp({command:process.execPath,args:[process.env.QW_BIN,'--acp'],cwd,home,env:{PATH:process.env.PATH},onLog:l=>logs.push(l),
   handlers:{requestPermission:async p=>{asked.push(p);const o=p.options.find(x=>x.kind===(allow?'allow_once':'reject_once'));return o?{outcome:'selected',optionId:o.optionId}:{outcome:'cancelled'};},
    readTextFile:async({path:f})=>({content:fs.readFileSync(f,'utf8')}),writeTextFile:async({path:f,content})=>{fs.writeFileSync(f,content);return null;},sessionUpdate:u=>updates.push(u)}});
  const t=setTimeout(()=>{console.log('TIMEOUT',JSON.stringify({seen,tools:toolNames,asked:asked.length,logs:logs.join('').slice(-1200)}));process.exit(2)},90000);
  const out=await agent.prompt('Write proof.txt');clearTimeout(t);
  const proof=fs.existsSync(path.join(cwd,'proof.txt'));
  const a=asked[0]?.toolCall;
  console.log(JSON.stringify({allow,hostile,stopReason:out.stopReason,askedCount:asked.length,kind:a?.kind,raw:JSON.stringify(a?.rawInput||{}).slice(0,120),options:asked[0]?.options.map(o=>o.kind),noeviaAction:a?classify(a).action:null,proofWritten:proof}));
  if(asked.length<1||proof!==allow)ok=false;
  setTimeout(()=>{try{fs.rmSync(root,{recursive:true,force:true})}catch{}},2000);
 }
 console.log('requests',JSON.stringify([...new Set(seen)]),'shellTool',toolNames.find(n=>/shell/.test(n||'')));console.log(ok?'PASS qwen-code: pinned endpoint only, Allow once runs the shell call, Decline blocks it, a repo yolo setting cannot skip approval':'FAIL');server.close();setTimeout(()=>process.exit(ok?0:1),2500);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
