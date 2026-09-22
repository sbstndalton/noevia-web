'use strict';
const assert=require('node:assert/strict');
if(process.env.NOEVIA_RUN_LAYA_CHAT_SMOKE!=='1')throw Error('Explicit real-inference opt-in required');
const smokeModel=process.env.COWORK_SMOKE_MODEL;if(!smokeModel)throw Error('Explicit installed model required');
const base=process.env.INFERENCE_BASE_URL;const host=new URL(base).hostname;if(host!=='llama')throw Error('This smoke fixture only targets the private llama service');
let layaCalls=0;
const decisions=[];
const realDecision=require('../server/decision-endpoint.cjs').createDecisionEndpoint();
const supervision=require('../server/step-supervision.cjs').createStepSupervision({enabled:()=>true,deadlineMs:1500,provider:{async decide(...args){layaCalls++;const result=await realDecision.decide(...args);decisions.push(result);return result;}}});
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {createChatHandler}=require('../server/chat.cjs');
const {createToolExchange}=require('../server/tool-exchange.cjs');
const {createVisionProbe}=require('../server/vision.cjs');
const {createChatTurns}=require('../server/chat-turns.cjs');
async function run(t,ambiguous=false,stepSupervision=null,providerId='default') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'noevia-chat-durable-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const userId='synthetic-user',projectId='fixture-project',service=createChatTurns({enabled:true});
  const events=[],res=new EventEmitter();res.writeHead=()=>{};res.write=line=>{if(line.startsWith('data: '))events.push(JSON.parse(line.slice(6)));};res.end=()=>{res.writableEnded=true;res.emit('finish');};
  let requests=0,executions=0;
  const fetch=async(url,init)=>{requests++;if(requests>2)throw Error('Smoke request cap exceeded');const payload=JSON.parse(init.body);payload.max_tokens=256;payload.chat_template_kwargs={enable_thinking:false};payload.tool_choice=requests===1?'required':'none';return globalThis.fetch(url,{...init,body:JSON.stringify(payload),signal:AbortSignal.any([init.signal,AbortSignal.timeout(90000)])});};
  const context = {
    modelManager:{enabled:true,health:async()=>({ok:true,body:{all_models_loaded:[{model_name:smokeModel,loaded:true,recipe_options:{ctx_size:32768}}]}})},
    reasoningEffort: require('../server/reasoning-effort.cjs'),
    authService: {audit() {}},
    crypto: require('node:crypto'), path, fetch,
    fs,
    HISTORY_CAP: 20, DEFAULT_PROVIDER_ID: 'default', createToolExchange,
    currentWorkspace: () => ({ userId, dir, assetDir: () => '/synthetic-only' }),
    getProject: () => ({id:projectId,model:smokeModel,assets:[]}),
    skillsIndexFor: () => [], getProvider: () => ({ id: providerId, baseUrl: base }),
    providerHeaders: () => (process.env.INFERENCE_API_KEY ? {Authorization:'Bearer '+process.env.INFERENCE_API_KEY} : {}), autoRoles: () => null,
    visionDescriptions: new Map(), visionProbe: createVisionProbe({ fetchImpl: fetch }),
    chatSkillRouter: { select: async () => ({ loaded: [] }) }, oauthServerIds: () => new Set(), accountReady: () => true, mcpOAuth: { connected: () => false }, chatToolRouter: { select: async (ids) => ({ ids, routed: false }) }, DEFAULT_TOOLBOXES: [],
    CONNECTOR_BOXES: new Set(['gdrive']), connectedBoxes: () => [], toolPolicy: { mode: (_user, _name, write) => (write ? 'ask' : 'allow') }, requestScope: { getStore: () => ({}) },
    resolveTools: () => ({ tools: [{type:'function',function:{name:'synthetic_write',parameters:{type:'object'}}}], dropped: [] }), isWriteTool: () => true,
  };
  const { handleChat } = createChatHandler({
    rag: { filesContext: async () => null }, prefill: { recordSample() {} }, reduceToolResult: () => ({ text:'reduced' }), diaryExtras: require('../server/diary-extras.cjs'),
    DIARY_BASE: 'http://fixture.invalid', TOOL_RESULT_CAP: 8000, json: () => {}, saveChats() {}, endpointApproved: () => true, diaryHeaders: () => ({}),
    lastLoadedModel: () => null, classifyFastOrSmart: async () => 'fast', servedCatalogue: async () => [], modelsInstalled: async () => [], missingRoles: () => [], staleRolesError: () => null,
    allToolboxes: () => [], executeToolCall: async () => { executions++; if (ambiguous) throw Error('connection lost after write'); return 'complete synthetic result'; }, chatWideApproved: () => false, awaitApproval: async ({onDecision}) => {onDecision('approve_all'); return 'approve';}, recordUsage() {}, recordToolUse() {},
    ...context, durableChat:service, stepSupervision,
  });
  await handleChat({},res,{projectId,chatId:'fixture-chat',message:'Synthetic test only: call synthetic_write exactly once with empty arguments. After its result, reply with the words fixture complete. Do not call any other tools.'});
  const job=require('../server/jobs.cjs').createJobs({dir}).list({kind:'chat'})[0];
  return {service,workspace:{dir,userId},id:job.id,executions,requests,events};
}

(async()=>{
  const cleanup=[];
  try {
    const result=await run({after:fn=>cleanup.push(fn)},false,supervision);
    console.log(JSON.stringify({requests:result.requests,executions:result.executions,layaCalls,decisions,events:result.events.filter(e=>['error','delta','done'].includes(e.type))}));
    assert.equal(result.executions,1,'synthetic tool must execute exactly once');
    assert.equal(layaCalls,1,'Laya checkpoint must be reached once');
    assert.equal(decisions.length,1,'Laya must return a valid decision, not fallback');
    assert.equal(result.requests,decisions[0].action==='escalate'?1:2);
    assert.ok(result.events.some(e=>e.type==='done'));
    assert.equal(result.events.filter(e=>e.type==='error').length,decisions[0].action==='escalate'?1:0);
    console.log(JSON.stringify({ok:true,model:smokeModel,modelRequests:result.requests,toolExecutions:result.executions,layaCalls,decisions,visibleOutput:result.events.filter(e=>e.type==='delta').map(e=>e.text).join('') }));
  } finally {cleanup.forEach(fn=>fn());}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
