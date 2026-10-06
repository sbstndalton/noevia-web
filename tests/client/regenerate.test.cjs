// #356: planRegenerate (regenerate.ts) is the pure guard + truncation behind Regenerate. It is
// exercised directly here with synthetic messages (never real chat data) since App.tsx's own
// regenerateLast is a closure that needs a live SSE stream to test end to end.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadPure(relPath) {
  const file = path.join(__dirname, '..', relPath);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  // Relative imports of other pure modules resolve (#658: applied-writes); anything else is a stub.
  vm.runInNewContext(code, { exports, require: (m) => (/^\.\/[\w-]+$/.test(m) && fs.existsSync(path.join(path.dirname(file), `${m}.ts`)) ? loadPure(path.relative(path.join(__dirname, '..'), path.join(path.dirname(file), `${m}.ts`))) : {}) });
  return exports;
}

const { planRegenerate, resendOutcome } = loadPure('../src/regenerate.ts');

const user = (id, content) => ({ id, role: 'user', content });
// A "loaded" assistant reply carrying the metadata a real turn accumulates: routing decision,
// tool calls, usage stats, reasoning/thinking and a sender label. None of it should survive into
// a regenerate plan.
const assistantReply = (id, content, extra = {}) => ({
  id, role: 'assistant', content,
  senderLabel: 'Assistant · Auto (smart)',
  routingDecision: { status: 'accepted', effectiveRole: 'smart', offered: [], scores: {} },
  reasoning: 'private chain of thought that must never resend',
  reasoningMs: 4200,
  toolCalls: [{ name: 'nextcloud_search', args: '{}', result: 'ok', status: 'done' }],
  stats: { promptTokens: 120, completionTokens: 80, totalTokens: 200, tokensPerSecond: 12.3, elapsedMs: 6500 },
  ...extra,
});

test('truncates to before the user turn and returns that turn\'s text', () => {
  const msgs = [user('u1', 'first'), assistantReply('a1', 'first answer'), user('u2', 'second question'), assistantReply('a2', 'second answer')];
  const plan = planRegenerate(msgs, 'a2');
  assert.ok(plan);
  assert.equal(plan.userText, 'second question');
  assert.deepEqual(plan.base, [msgs[0], msgs[1]]);
});

test('the plan carries the Skill pin the user turn was sent with, and none when it had none (#571)', () => {
  const pin = `skill_${'a'.repeat(32)}@${'b'.repeat(64)}`;
  const pinned = planRegenerate([{ ...user('u1', 'q'), skill: pin }, assistantReply('a1', 'a')], 'a1');
  assert.equal(pinned.skill, pin);
  assert.equal('skill' in planRegenerate([user('u1', 'q'), assistantReply('a1', 'a')], 'a1'), false);
});

test('the returned plan carries no routing/telemetry/thinking metadata from the old reply', () => {
  const msgs = [user('u1', 'question'), assistantReply('a1', 'answer', { toolScope: 'nextcloud', skillScope: 'writing' })];
  const plan = planRegenerate(msgs, 'a1');
  assert.ok(plan);
  // The old reply is not present anywhere in the plan at all — not even stripped of fields —
  // so there is nothing left to accidentally read routingDecision/reasoning/stats/toolCalls off of.
  assert.equal(plan.base.some((m) => m.id === 'a1'), false);
  assert.equal(JSON.stringify(plan).includes('smart'), false, 'no routing decision leaked into the plan');
  assert.equal(JSON.stringify(plan).includes('chain of thought'), false, 'no reasoning leaked into the plan');
  assert.equal(JSON.stringify(plan).includes('nextcloud_search'), false, 'no tool call leaked into the plan');
});

test('#658: a reply that saved changes leaves their record, and only that, so the re-run does not make them again', () => {
  const saved = { name: 'project_append_file', args: '{"name":"n.md","text":"x"}', result: 'Appended 1 chars', status: 'done', applied: true, target: 'noevia projects/P/Text/n.md' };
  const msgs = [user('u1', 'append x to n.md'), assistantReply('a1', 'Done, appended.', { toolCalls: [saved] })];
  const plan = planRegenerate(msgs, 'a1');
  assert.equal(plan.userText, 'append x to n.md');
  assert.equal(plan.base.length, 2, 'the user turn and the record');
  const record = plan.base[1];
  assert.equal(record.content, '');
  assert.deepEqual(JSON.parse(JSON.stringify(record.paused)), { reason: 'stopped', applied: 1 });
  assert.equal(record.toolCalls[0].applied, true);
  for (const leaked of ['smart', 'chain of thought', 'Done, appended', 'tokensPerSecond']) assert.equal(JSON.stringify(plan).includes(leaked), false, leaked);
});

test('declines when the target is not the last message', () => {
  const msgs = [user('u1', 'first'), assistantReply('a1', 'first answer'), user('u2', 'second'), assistantReply('a2', 'second answer')];
  assert.equal(planRegenerate(msgs, 'a1'), null);
});

test('declines an errored reply — that is what Retry is for', () => {
  const msgs = [user('u1', 'q'), { id: 'a1', role: 'assistant', content: 'Request failed', error: true }];
  assert.equal(planRegenerate(msgs, 'a1'), null);
});

test('declines a Cowork task reply', () => {
  const msgs = [user('u1', 'do a task'), assistantReply('a1', 'started', { coworkTask: { projectId: 'p1', taskId: 't1', repository: 'repo' } })];
  assert.equal(planRegenerate(msgs, 'a1'), null);
});

test('declines when the message before the reply is not a user turn', () => {
  const msgs = [assistantReply('a0', 'stray'), assistantReply('a1', 'answer')];
  assert.equal(planRegenerate(msgs, 'a1'), null);
});

test('declines an unknown message id', () => {
  const msgs = [user('u1', 'q'), assistantReply('a1', 'answer')];
  assert.equal(planRegenerate(msgs, 'does-not-exist'), null);
});

test('declines the very first message (nothing before it)', () => {
  const msgs = [user('u1', 'q')];
  assert.equal(planRegenerate(msgs, 'u1'), null);
});

// App.tsx's regenerateLast must reuse the existing truncate-and-resend `handleSend` path (the
// same one Retry and Edit-and-re-run already use) rather than a new endpoint, and must refuse to
// act while that chat is already streaming.
test('App.tsx wires Regenerate through planRegenerate + the existing handleSend path, guarded by streamingChats', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  const fn = src.slice(src.indexOf('const regenerateLast = useCallback'), src.indexOf('const startFreeChat = useCallback'));
  assert.match(fn, /if \(streamingChats\[chatId\]\) return;/);
  assert.match(fn, /planRegenerate\(msgs, messageId\)/);
  // #682: plus a text-free resend marker (kind and the replaced reply's routed role).
  assert.match(fn, /void handleSend\(chatId, projectId, plan\.userText, plan\.base, \{ \.\.\.\(plan\.skill \? \{ skill: plan\.skill \} : \{\}\), resend: resendOutcome\('regenerate', msgs\[msgs\.length - 1\]\) \}\);/);
  assert.doesNotMatch(fn, /apiFetch\(|fetch\(/, 'regenerateLast must not call a new endpoint directly');
});

// #682: the resend marker carries only enumerated routing values of the replaced reply, never text.
test('resendOutcome keeps only the kind and the routed role/status of the replaced reply', () => {
  const plain = (v) => JSON.parse(JSON.stringify(v)); // the module runs in its own vm realm
  const reply = { id: 'a1', role: 'assistant', content: 'SYNTHETIC reply text', routingDecision: { effectiveRole: 'fast', status: 'accepted', offered: [{ id: 'fast', label: 'SYNTHETIC label' }], scores: { fast: 0.9 } } };
  assert.deepEqual(plain(resendOutcome('regenerate', reply)), { kind: 'regenerate', role: 'fast', status: 'accepted' });
  assert.deepEqual(plain(resendOutcome('retry', { id: 'a2', role: 'assistant', content: 'x', error: true })), { kind: 'retry' });
  assert.deepEqual(plain(resendOutcome('regenerate', { ...reply, routingDecision: { effectiveRole: 'SYNTHETIC injected', status: 'weird' } })), { kind: 'regenerate' });
  assert.deepEqual(plain(resendOutcome('regenerate', undefined)), { kind: 'regenerate' });
});
