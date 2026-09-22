// Opt-in, synthetic: real pi (PI_BIN=path to a pi 0.87+ binary) + noevia's pinned pi config and gate +
// services/code-sandbox/pi-acp-bridge.cjs + noevia's ACP client, against a scripted local fake model
// (127.0.0.1:31301) that asks for one bash command. Proves Allow once runs it and Decline does not.
// No real model, network, Diary or production. Run: PI_BIN=/path/to/pi node qa/pi-bridge-e2e.cjs
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
if(!process.env.PI_BIN)throw Error('Set PI_BIN to a pi binary (opt-in suite).');
const APP=require('node:path').resolve(__dirname,'../../..');
const {writeHarnessConfig}=require(APP+'/apps/web/server/code-harness-config.cjs');
const {connectAcp}=require(APP+'/apps/web/server/code-acp.cjs');
const {classify}=require(APP+'/apps/web/server/code-actions.cjs');
let calls=0,ok=true;
const sse=(res,chunks)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const c of chunks)res.write('data: '+JSON.stringify(c)+'\n\n');res.end('data: [DONE]\n\n');};
const server=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{calls++;const body=JSON.parse(b||'{}');
 const hasTool=(body.messages||[]).some(m=>m.role==='tool');
 const base={id:'x',object:'chat.completion.chunk',created:1,model:body.model};
 if(!hasTool) sse(res,[{...base,choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_e2e',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'echo noevia-e2e > proof.txt'})}}]},finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}]);
 else sse(res,[{...base,choices:[{index:0,delta:{role:'assistant',content:'finished'},finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}]);
});});
(async()=>{
 await new Promise(r=>server.listen(31301,'127.0.0.1',r));
 for(const allow of [true,false]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-e2e-')),cwd=path.join(root,'tree'),home=path.join(root,'home');fs.mkdirSync(cwd);fs.mkdirSync(home);
  const rec=writeHarnessConfig({harness:'pi',cwd,home,model:'fake-model',engine:'http://127.0.0.1:31301/v1'});
  const asked=[],updates=[];
  const agent=await connectAcp({command:process.execPath,args:[APP+'/services/code-sandbox/pi-acp-bridge.cjs'],cwd,home,
   env:{PI_COMMAND:process.env.PI_BIN,PATH:process.env.PATH},onLog:l=>process.env.DEBUG&&process.stderr.write(l),
   handlers:{requestPermission:async p=>{asked.push(p.toolCall);return {outcome:'selected',optionId:allow?'allow_once':'reject_once'};},
    readTextFile:async()=>{throw Error('x')},writeTextFile:async()=>{throw Error('x')},sessionUpdate:u=>updates.push(u)}});
  const t=setTimeout(()=>{console.log('TIMEOUT',JSON.stringify({asked,updates}).slice(0,800));process.exit(2)},60000);
  const out=await agent.prompt('Write proof.txt');clearTimeout(t);
  const proof=fs.existsSync(path.join(cwd,'proof.txt'));
  console.log(JSON.stringify({allow,stopReason:out.stopReason,pinned:rec.files,askedCount:asked.length,asked:asked.map(a=>({kind:a.kind,command:a.rawInput?.command,noeviaAction:classify(a).action})),proofWritten:proof,text:updates.filter(u=>u.sessionUpdate==='agent_message_chunk').map(u=>u.content.text).join('')}));
  if(out.stopReason!=='end_turn'||asked.length!==1||asked[0].rawInput?.command!=='echo noevia-e2e > proof.txt'||proof!==allow)ok=false;
  fs.rmSync(root,{recursive:true,force:true});
 }
 console.log('model calls',calls);server.close();
 if(!ok)process.exitCode=1;else console.log('PASS pi bridge: real pi asks through noevia; Allow once runs the command, Decline blocks it');
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
