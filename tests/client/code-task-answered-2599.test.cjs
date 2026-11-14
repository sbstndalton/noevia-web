// #2599: "1 Code task needs your decision" stayed up for seconds after Allow once, Decline or Cancel task, because the banner
// waited for its next poll and the server lags its own answer. applyAnswered shows a task the person just answered as answered for
// while the server's row for it is unchanged (cancelled: gone; allowed or declined: running), then trusts the server again.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/components/code/active-tasks.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sent = [];
const exports_ = {};
new Function('exports', 'require', 'window', 'CustomEvent', code)(exports_, (m) => { throw new Error('unexpected import ' + m); },
  { dispatchEvent: (event) => { sent.push(event); return true; } }, class { constructor(type, init) { this.type = type; this.detail = init.detail; } });
const { applyAnswered, announceCodeTaskAnswer, ANSWERED_HOLD_MS, ANSWERED_MAX_MS, CODE_TASK_ANSWERED } = exports_;

const waiting = { id: 't1', projectId: 'p', projectName: 'QA', title: 'QA task', status: 'waiting_approval', stage: null, updatedAt: 500, approvalAction: 'edit_file' };
const other = { id: 't2', projectId: 'p', projectName: 'QA', title: 'QA other', status: 'waiting_approval', stage: null, updatedAt: 1, approvalAction: 'execute_command' };
const mark = (answer, at, updatedAt = 500) => new Map([['t1', { answer, at, updatedAt }]]);

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

test('a lagging poll cannot bring the banner back while the server row is the one that was answered', () => {
  // Well past the short hold, the row has not moved (same updatedAt): still answered.
  assert.equal(applyAnswered([waiting], mark('approve', 1000), 1000 + ANSWERED_HOLD_MS + 5000)[0].status, 'running');
  assert.deepEqual(applyAnswered([waiting], mark('cancel', 1000), 1000 + ANSWERED_HOLD_MS + 5000), []);
});

test('a row that has moved is the server speaking: a second request for a decision is shown at once', () => {
  const second = { ...waiting, updatedAt: 501, approvalAction: 'execute_command' };
  assert.deepEqual(applyAnswered([second], mark('approve', 1000), 1100), [second]);
  assert.deepEqual(applyAnswered([{ ...waiting, updatedAt: 900, status: 'running', approvalAction: null }], mark('cancel', 1000), 1100).length, 1, 'a task still running after a cancel is shown');
});

test('the longest hold ends: the server is believed again', () => {
  assert.deepEqual(applyAnswered([waiting], mark('approve', 1000), 1000 + ANSWERED_MAX_MS), [waiting]);
  assert.deepEqual(applyAnswered([waiting], mark('cancel', 1000), 1000 + ANSWERED_MAX_MS + 1), [waiting]);
});

test('with no row to compare (the task was not in the list) only the short hold applies', () => {
  assert.equal(applyAnswered([waiting], mark('approve', 1000, null), 1000 + ANSWERED_HOLD_MS - 1)[0].status, 'running');
  assert.deepEqual(applyAnswered([waiting], mark('approve', 1000, null), 1000 + ANSWERED_HOLD_MS), [waiting]);
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
