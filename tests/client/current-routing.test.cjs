'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/current-routing.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exports_ });
const { currentRoutingDecision, isDisplayableRoutingDecision } = exports_;

test('stats routing follows only the latest assistant turn in the visible chat', () => {
  const route = { status: 'accepted', effectiveRole: 'smart' };
  const firstChat = [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'answer', routingDecision: route }];
  const otherChat = [{ role: 'user', content: 'two' }, { role: 'assistant', content: 'other answer' }];
  assert.equal(currentRoutingDecision(firstChat, true), route);
  assert.equal(currentRoutingDecision(firstChat, false), null);
  assert.equal(currentRoutingDecision(otherChat, true), null);
  assert.equal(currentRoutingDecision([...firstChat, { role: 'user', content: 'next' }], true), null);
  assert.equal(currentRoutingDecision([...firstChat, { role: 'user', content: 'next' }, { role: 'assistant', content: '' }], true), null);
  assert.equal(currentRoutingDecision([...firstChat, { role: 'user', content: 'manual' }, { role: 'assistant', content: 'manual answer' }], true), null);
  assert.equal(currentRoutingDecision(structuredClone(firstChat), true).effectiveRole, 'smart');
});

test('malformed or hand-edited routing fields are never displayable — only the shape this build understands is', () => {
  const valid = { offered: [{ id: 'fast', label: 'Short answer' }], scores: { fast: 0.5 }, selectedRole: 'fast',
    effectiveRole: 'fast', backend: 'llama-logit', model: null, calibrated: false, latencyMs: 12,
    status: 'accepted', fallbackReason: null };
  assert.equal(isDisplayableRoutingDecision(valid), true);
  assert.equal(isDisplayableRoutingDecision(null), false);
  assert.equal(isDisplayableRoutingDecision(undefined), false);
  assert.equal(isDisplayableRoutingDecision('routed to smart'), false);
  assert.equal(isDisplayableRoutingDecision(42), false);
  assert.equal(isDisplayableRoutingDecision({}), false);
  assert.equal(isDisplayableRoutingDecision({ ...valid, offered: 'fast,smart' }), false, 'offered must be an array');
  assert.equal(isDisplayableRoutingDecision({ ...valid, status: 'pending' }), false, 'unknown status is rejected');
  assert.equal(isDisplayableRoutingDecision({ ...valid, effectiveRole: 'vision' }), false, 'unknown role is rejected');
  assert.equal(isDisplayableRoutingDecision({ ...valid, offered: undefined }), false, 'missing offered is rejected');
  // A future export field or a typo from a hand-edited backup must not crash the panel either.
  assert.equal(isDisplayableRoutingDecision({ ...valid, futureField: { nested: true } }), true);
});
