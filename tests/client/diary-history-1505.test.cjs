'use strict';
// #1505: only completed user+assistant pairs go into the Diary history sent to the model. A failed,
// uncertain, dismissed or still-running exchange, a user turn with no answer, and an answer whose
// question fell outside the window are left out, so a new message is never answered with an older
// stuck question. Synthetic fixtures only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
process.env.TZ = 'America/New_York';

function load(name) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../src', name + '.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, Date, require: name => load(name.replace('./', '')) });
  return exports;
}
const { diaryHistory, diaryExchangeTarget } = load('diary-conversation');
const { recoverDiaryTurns } = load('diary-server-recovery');
const plain = (history) => JSON.parse(JSON.stringify(history));

test('a completed exchange is sent as its user turn and its answer, in order', () => {
  const history = diaryHistory([
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'A1' },
  ]);
  assert.deepEqual(plain(history), [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }]);
});

test('a failed exchange (saved:false, or failed on the server) is never sent, in either turn', () => {
  const history = diaryHistory([
    { role: 'user', content: 'Q-failed', failed: true },
    { role: 'assistant', content: 'partial', failed: true },
    { role: 'user', content: 'Q2' },
    { role: 'assistant', content: 'A2' },
  ]);
  assert.deepEqual(plain(history), [{ role: 'user', content: 'Q2' }, { role: 'assistant', content: 'A2' }]);
});

test('an uncertain exchange (save outcome not confirmed) is never sent, even with a partial answer', () => {
  const history = diaryHistory([
    { role: 'user', content: 'Q-unsure', uncertain: true },
    { role: 'assistant', content: 'half an answer', uncertain: true },
    { role: 'user', content: 'Q2' },
    { role: 'assistant', content: 'A2' },
  ]);
  assert.deepEqual(plain(history), [{ role: 'user', content: 'Q2' }, { role: 'assistant', content: 'A2' }]);
});

test('an exchange still running on the server is not sent as a half answer', () => {
  const history = diaryHistory([
    { role: 'user', content: 'Q-running', running: true },
    { role: 'assistant', content: 'so far', running: true },
  ]);
  assert.deepEqual(plain(history), []);
});

test('a user turn with no answer is never sent, so a stuck question is not answered again', () => {
  const history = diaryHistory([
    { role: 'user', content: 'stuck question' },
    { role: 'user', content: 'new question' },
    { role: 'assistant', content: 'answer to the new question' },
  ]);
  assert.deepEqual(plain(history), [
    { role: 'user', content: 'new question' },
    { role: 'assistant', content: 'answer to the new question' },
  ]);
});

test('an empty answer counts as no answer', () => {
  const history = diaryHistory([
    { role: 'user', content: 'Q' },
    { role: 'assistant', content: '   ' },
  ]);
  assert.deepEqual(plain(history), []);
});

test('an answer whose question fell outside the window is not sent on its own', () => {
  const history = diaryHistory([
    { role: 'assistant', content: 'orphaned answer' },
    { role: 'user', content: 'Q' },
    { role: 'assistant', content: 'A' },
  ]);
  assert.deepEqual(plain(history), [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }]);
});

test('applied writes still follow the completed answer they belong to, and nothing from a left-out exchange', () => {
  const history = diaryHistory([
    { role: 'user', content: 'log it', uncertain: true },
    { role: 'assistant', content: 'done', uncertain: true, tools: [{ name: 'extras_write', result: 'saved', applied: true }] },
    { role: 'user', content: 'log it again' },
    { role: 'assistant', content: 'done again', tools: [{ name: 'extras_write', result: 'saved', applied: true, target: 'notes/b.md' }] },
  ]);
  assert.deepEqual(plain(history), [
    { role: 'user', content: 'log it again' },
    { role: 'assistant', content: 'done again' },
    { role: 'tool', name: 'extras_write', content: 'saved', applied: true, target: 'notes/b.md' },
  ]);
});

test('a dismissed uncertain exchange, as the server returns it, is left out of the next message\'s history', () => {
  const records = [
    { id: 'e1', message: 'Q-dismissed', content: 'A-dismissed', reasoning: '', startedAt: 1, activity: [], state: 'uncertain', decision: '', acknowledgedAt: 99 },
    { id: 'e2', message: 'Q-done', content: 'A-done', reasoning: '', startedAt: 2, activity: [], state: 'done', decision: 'logged' },
  ];
  const turns = recoverDiaryTurns(records);
  const { history } = diaryExchangeTarget('2026-09-10', { '2026-09-10': turns }, new Date('2026-09-10T15:00:00Z'));
  assert.deepEqual(plain(history), [{ role: 'user', content: 'Q-done' }, { role: 'assistant', content: 'A-done' }]);
});

test('a failed or uncertain or still-running server record is flagged so it is not replayed', () => {
  const records = [
    { id: 'f', message: 'Q-f', content: '', reasoning: '', startedAt: 1, activity: [], state: 'failed', error: 'Nothing was saved.' },
    { id: 'u', message: 'Q-u', content: 'partial', reasoning: '', startedAt: 2, activity: [], state: 'uncertain' },
    { id: 'r', message: 'Q-r', content: 'partial', reasoning: '', startedAt: 3, activity: [], state: 'running' },
    { id: 'd', message: 'Q-d', content: 'A-d', reasoning: '', startedAt: 4, activity: [], state: 'done', decision: 'ok' },
  ];
  const turns = recoverDiaryTurns(records);
  const replayed = diaryHistory(turns);
  assert.deepEqual(plain(replayed), [{ role: 'user', content: 'Q-d' }, { role: 'assistant', content: 'A-d' }]);
  assert.equal(turns.find((t) => t.exchangeId === 'u').uncertain, true);
  assert.equal(turns.find((t) => t.exchangeId === 'r').running, true, 'a running exchange is flagged on its user turn');});

test('a preparation-only record never becomes history (it has no companion answer)', () => {
  const records = [
    { id: 'p1', kind: 'preparation', message: 'Prep question', content: 'reference text', reasoning: '', startedAt: 1, activity: [], state: 'done' },
    { id: 'c1', kind: 'capture', preparationId: 'p1', message: 'Q', content: 'A', reasoning: '', startedAt: 2, activity: [], state: 'done', decision: 'logged' },
  ];
  const replayed = diaryHistory(recoverDiaryTurns(records));
  assert.deepEqual(plain(replayed), [{ role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }]);
});

test('the live send path marks an exchange whose save was not confirmed as uncertain, not as an ordinary answer', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryView.tsx'), 'utf8');
  const catchStart = app.indexOf("if ((e as { saved?: unknown } | null)?.saved === false) {");
  const catchBlock = app.slice(catchStart, app.indexOf('if(diaryStarted && !folder)bumpRevision();', catchStart));
  assert.match(catchBlock, /else if \(diaryStarted\) \{[\s\S]*uncertain: true/, 'a started exchange with no confirmed save is held out of history');
});
