const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(file){const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new Function('module','exports','require',code)(m,m.exports,require);return m.exports;}
const {installedSummary}=load('models-summary.ts');
// model-kind.ts imports ./model-system (#1179): hand it that module, loaded the same way.
const systemMod=load('model-system.ts');
const {isChatGenerationModel,splitChatSections}=(()=>{const file='model-kind.ts';const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new Function('module','exports','require',code)(m,m.exports,(id)=>id==='./model-system'?systemMod:require(id));return m.exports;})();

test('installed summary names every loaded model from the same flag the manager cards use (#205)',()=>{
  const models=[{name:'a',loaded:false},{name:'chat-syn',loaded:true},{name:'b',loaded:false}];
  assert.equal(installedSummary(models),'3 models · loaded: chat-syn');
  assert.equal(installedSummary([{name:'a',loaded:false}]),'1 model · none loaded');
  assert.equal(installedSummary([{name:'a',loaded:true},{name:'b',loaded:true}]),'2 models · loaded: a, b');
  assert.equal(installedSummary([]),'0 models · none loaded');
});

test('prompt-suite picker keeps chat models and lists the rest as excluded (#206)',()=>{
  const installed=[{name:'chat-syn',labels:['vision']},{name:'vec-syn',labels:['embeddings']}];
  assert.deepEqual(splitChatSections(['chat-syn','vec-syn','nomic-embed-text-v1','qwen3-reranker-0.6b-q8_0','laya_multilingual_f16','other-chat'],installed),
    {chat:['chat-syn','other-chat'],excluded:['vec-syn','nomic-embed-text-v1','qwen3-reranker-0.6b-q8_0','laya_multilingual_f16']});
  assert.equal(isChatGenerationModel('x',['reranker']),false);
  assert.equal(isChatGenerationModel('x',[]),true);
});

test('the summary asks for a fresh list on mount and a finished reply notifies (#205)',()=>{
  const summary=fs.readFileSync(path.join(__dirname,'../../src/components/models/ModelsSummary.tsx'),'utf8');
  assert.match(summary,/useEffect\(\(\) => \{ notifyModelsChanged\(\); \}, \[\]\)/);
  const app=fs.readFileSync(path.join(__dirname,'../../src/App.tsx'),'utf8');
  assert.match(app,/sendingChats\.current\.delete\(chatId\);\n\s*\/\/[^\n]*\n\s*notifyModelsChanged\(\);/);
});

// #1179: the explicit system kind from the models list decides; the name rule is a logged fallback.
test('Laya is recognised by the explicit system kind from the models list, not by its name (#1179)',()=>{
  const warnings=[];const realWarn=console.warn;console.warn=(text)=>warnings.push(String(text));
  try{
    systemMod.rememberSystemModels([{name:'routing-box',system:true},{name:'laya-named-chat',system:false},{name:'plain-chat'}]);
    assert.equal(systemMod.isSystemModel('routing-box'),true,'role = laya marks Laya whatever its name');
    assert.equal(systemMod.isSystemModel('laya-named-chat'),false,'an explicit non-Laya kind beats the name');
    assert.equal(isChatGenerationModel('routing-box',[]),false);
    assert.equal(isChatGenerationModel('laya-named-chat',[]),true);
    assert.deepEqual(warnings,[],'no deprecation log while the list answers');
    assert.equal(systemMod.isSystemModel('laya_legacy'),true,'a name the list did not report falls back to the name rule');
    assert.equal(systemMod.isSystemModel('laya_legacy'),true);
    assert.equal(warnings.filter(w=>w.includes('laya_legacy')).length,1,'the fallback is logged once');
    assert.equal(isChatGenerationModel('plain-chat',[]),true);
  }finally{console.warn=realWarn;systemMod.rememberSystemModels([]);}
});
