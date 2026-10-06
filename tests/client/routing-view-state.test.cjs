const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../../src/routing-view-state.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports_={};vm.runInNewContext(code,{exports:exports_});
const {routingViewState}=exports_;

// #191: the GET /api/auto-roles round trip through the model manager left `info` null while it
// was in flight, and the Routing tab rendered as if Auto had genuinely never been configured.
test('info === null is loading, regardless of any stale error text left from a previous attempt',()=>{
  assert.equal(routingViewState(null,''),'loading');
});
test('a fetch error wins over a null or unconfigured info, so the form does not render past it',()=>{
  assert.equal(routingViewState(null,'Auto routing settings could not be loaded.'),'error');
  assert.equal(routingViewState({configured:false},'Auto routing settings could not be loaded.'),'error');
});
test('a loaded, unconfigured response is its own state, distinct from still-loading',()=>{
  assert.equal(routingViewState({configured:false},''),'unconfigured');
});
test('a loaded, configured response renders the form',()=>{
  assert.equal(routingViewState({configured:true},''),'configured');
});
