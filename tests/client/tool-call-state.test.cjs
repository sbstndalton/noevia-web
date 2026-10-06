const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const result={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/tool-call-state.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:result});
test('a reply that ended leaves no pending or running calls, and no approval ids', () => {
  const settled = result.settleToolCalls([
    { name: 'read', args: '{}', status: 'done', result: 'ok' },
    { name: 'write', args: '{"a":1}', status: 'pending', approvalId: 'ap-1' },
    { name: 'search', args: '{}', status: 'running' },
    { name: 'legacy', args: '{}' },
    { name: 'no', args: '{}', status: 'denied', result: 'ERROR: the user declined' },
  ]);
  assert.deepEqual(settled.map((c) => c.status), ['done', 'stopped', 'stopped', 'stopped', 'denied']);
  assert.ok(settled.every((c) => c.approvalId === undefined));
  assert.equal(settled[1].args, '{"a":1}', 'arguments are kept for the record');
  assert.equal(result.settleToolCalls(undefined), undefined);
});

// #793: a "This looks sensitive" routing question dies with the request; Stop must not leave it answerable.
test('a reply that ended drops its routing question and settles its tool calls', () => {
  const ended = result.settleReply({ id: 'r1', role: 'assistant', content: '', routePending: { id: 'rp-1', flag: 'secret' },
    toolCalls: [{ name: 'write', args: '{}', status: 'pending', approvalId: 'ap-1' }] });
  assert.equal('routePending' in ended, false);
  assert.equal(ended.toolCalls[0].status, 'stopped');
  assert.equal(ended.toolCalls[0].approvalId, undefined);
  const onlyRoute = result.settleReply({ id: 'r2', role: 'assistant', content: 'x', routePending: { id: 'rp-2', flag: 'iban' } });
  assert.equal('routePending' in onlyRoute, false);
  assert.equal('toolCalls' in onlyRoute, false, 'no empty toolCalls field is invented');
  // With routing modes off there is never a routePending, and a reply without tool calls is untouched.
  const plain = { id: 'r3', role: 'assistant', content: 'hello' };
  assert.equal(result.settleReply(plain), plain);
});
