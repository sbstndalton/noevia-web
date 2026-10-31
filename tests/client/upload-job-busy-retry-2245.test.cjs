'use strict';
// #2245 (noevia-rs#362): a source upload job can itself end 429, "Another upload or sync of this project is still
// running; try again shortly." The job did nothing, so the file is sent again after a short wait, within the same
// bounded budget as a busy answer at the door (#1451). Any other job failure is thrown as it was.
// Synthetic XHR and job poll only; no network.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
const block = source.slice(source.indexOf('function failureWithCode'), source.indexOf('/** Delete one source'));
const js = ts.transpileModule(block.replace(/export /g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(posts, jobs) {
  const attempts = [], delays = [];
  class XHR {
    upload = {}; timeout = 0; status = 0; responseText = '';
    open(method, url) { attempts.push({ method, url }); }
    setRequestHeader() {}
    getResponseHeader() { return null; }
    send() { const r = posts.shift(); this.status = r.status; this.responseText = JSON.stringify(r.body); this.onload(); }
  }
  const ctx = {
    WORKSPACE_KEY: 'workspace', invalidateCached() {}, clearRequestCache() {}, accountChangedElsewhere: () => false, AccountChangedError: Error, XMLHttpRequest: XHR, cookie: () => 'synthetic-csrf',
    setTimeout: (fn, ms) => { delays.push(ms); fn(); }, hasApiMajorMismatchHeader: () => false, API_MAJOR: '1', window: { dispatchEvent() {} },
    getJson: async () => jobs.shift(),
  };
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  return { ctx, attempts, delays };
}
const accepted = { status: 202, body: { poll: '/api/projects/p/source-jobs/j' } };
const busy = { status: 429, body: { error: 'Source processing is busy; wait for the current operation and retry.' } };
const jobBusy = { done: true, status: 429, body: { error: 'Another upload or sync of this project is still running; try again shortly.' } };
const saved = { done: true, status: 200, body: { name: 'notes.md', path: 'notes.md', bytes: 3 } };
const send = (h, progress) => h.ctx.uploadProjectFile('p', { name: 'notes.md', dataBase64: 'YWJj' }, progress);

test('#2245: a job that ends busy is sent again after a wait, and the file is saved', async () => {
  const h = harness([accepted, accepted, accepted], [jobBusy, jobBusy, saved]);
  const stages = [];
  const result = await send(h, (v) => stages.push(v));
  assert.equal(result.name, 'notes.md');
  assert.equal(h.attempts.length, 3, 'sent again after each busy job');
  assert.deepEqual(h.delays, [1000, 2000]);
  assert.equal(stages.filter((v) => v.stageKey === 'busy').length, 2, 'the wait is shown');
  assert.equal(stages.at(-1).stageKey, 'saved');
});

test('#2245: a job that is busy every time gives up after the bounded retries, with the job\'s own message', async () => {
  const h = harness(Array(6).fill(accepted), Array(6).fill(jobBusy));
  await assert.rejects(send(h), (err) => { assert.equal(err.message, jobBusy.body.error); return true; });
  assert.equal(h.attempts.length, 5, 'one try, then four retries');
  assert.deepEqual(h.delays, [1000, 2000, 4000, 8000]);
});

test('#2245: busy at the door and busy as a job share one budget', async () => {
  const h = harness([busy, busy, accepted, busy, accepted, accepted, accepted, accepted], [jobBusy, jobBusy, jobBusy, jobBusy]);
  await assert.rejects(send(h), (err) => err.message === jobBusy.body.error);
  assert.deepEqual(h.delays, [1000, 2000, 4000, 8000], 'four waits in all, not four per kind');
});

test('#2245: any other job failure is not retried', async () => {
  const h = harness([accepted], [{ done: true, status: 422, body: { error: 'Source processing failed; refresh or re-upload to retry.', code: 'failed' } }]);
  await assert.rejects(send(h), (err) => { assert.equal(err.code, 'failed'); return true; });
  assert.equal(h.attempts.length, 1);
  assert.deepEqual(h.delays, []);
});
