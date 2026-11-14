// #2599: "1 Code task needs your decision" stayed up for seconds after Allow once, Decline or Cancel task, because the banner
// waited for its next poll and the server lags its own answer. applyAnswered shows a task the person just answered as answered for
// ANSWERED_HOLD_MS (cancelled: gone; allowed or declined: running), then trusts the server again.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/components/code/active-tasks.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sent = [];
const exports_ = {};
new Function('exports', 'require', 'window', 'CustomEvent', code)(exports_, (m) => { throw new Error('unexpected import ' + m); },
  { dispatchEvent: (event) => { sent.push(event); return true; } }, class { constructor(type, init) { this.type = type; this.detail = init.detail; } });
const { applyAnswered, announceCodeTaskAnswer, ANSWERED_HOLD_MS, CODE_TASK_ANSWERED } = exports_;

const waiting = { id: 't1', projectId: 'p', projectName: 'QA', title: 'QA task', status: 'waiting_approval', stage: null, updatedAt: 1, approvalAction: 'edit_file' };
const other = { id: 't2', projectId: 'p', projectName: 'QA', title: 'QA other', status: 'waiting_approval', stage: null, updatedAt: 1, approvalAction: 'execute_command' };
const mark = (answer, at) => new Map([['t1', { answer, at }]]);

test('an allowed or declined task stops waiting at once, and only that task', () => {
  for (const answer of ['approve', 'approve_all', 'deny']) {
    const shown = applyAnswered([waiting, other], mark(answer, 1000), 1500);
    assert.equal(shown[0].status, 'running', answer);
    assert.equal(shown[0].approvalAction, null, answer);
    assert.deepEqual(shown[1], other, 'a task nobody answered is untouched');
  }
});

test('a cancelled task is gone at once', () => {
  assert.deepEqual(applyAnswered([waiting, other], mark('cancel', 1000), 1500), [other]);
});

test('after the hold the server is believed again (a second request may be waiting)', () => {
  assert.deepEqual(applyAnswered([waiting], mark('approve', 1000), 1000 + ANSWERED_HOLD_MS), [waiting]);
  assert.deepEqual(applyAnswered([waiting], mark('cancel', 1000), 1000 + ANSWERED_HOLD_MS + 1), [waiting]);
});

test('a running task, and no answers at all, pass through; the input is not changed', () => {
  const running = { ...waiting, status: 'running', approvalAction: null };
  assert.deepEqual(applyAnswered([running], mark('approve', 1000), 1100), [running]);
  const tasks = [waiting];
  assert.deepEqual(applyAnswered(tasks, new Map(), 5), [waiting]);
  applyAnswered(tasks, mark('approve', 1000), 1100);
  assert.equal(tasks[0].status, 'waiting_approval');
});

test('announcing an answer sends one window event carrying it', () => {
  announceCodeTaskAnswer({ taskId: 't1', answer: 'deny' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, CODE_TASK_ANSWERED);
  assert.deepEqual({ ...sent[0].detail }, { taskId: 't1', answer: 'deny' });
});
