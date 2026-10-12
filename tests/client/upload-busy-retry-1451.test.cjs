'use strict';
// #1451: the server answers 429 to a source upload while two source jobs are already running for the
// account. That answer creates no job, so the same file is sent again after a short wait, a bounded
// number of times; any other failure, or a busy answer after the last retry, is reported as it was.
// Synthetic XHR and job poll only; no network.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/api.ts'), 'utf8');
const block = source.slice(source.indexOf('function failureWithCode'), source.indexOf('/** Delete one source'));
const js = ts.transpileModule(block.replace(/export /g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(responses) {
  const attempts = [], delays = [], stages = [];
  class XHR {
    upload = {}; timeout = 0; status = 0; responseText = '';
    open(method, url) { attempts.push({ method, url }); }
    setRequestHeader() {}
    getResponseHeader() { return null; }
    send() { const r = responses.shift(); this.status = r.status; this.responseText = JSON.stringify(r.body); this.onload(); }
  }
  const ctx = {
    WORKSPACE_KEY: 'workspace', invalidateCached() {}, clearRequestCache() {}, XMLHttpRequest: XHR, cookie: () => 'synthetic-csrf',
    setTimeout: (fn, ms) => { delays.push(ms); fn(); }, hasApiMajorMismatchHeader: () => false, API_MAJOR: '1', window: { dispatchEvent() {} },
    getJson: async () => ({ done: true, status: 200, body: { name: 'notes.md', path: 'notes.md', bytes: 3 } }),
  };
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  return { ctx, attempts, delays, stages };
}

const busy = { status: 429, body: { error: 'Source processing is busy; wait for the current operation and retry.' } };
const accepted = { status: 202, body: { poll: '/api/projects/p/source-jobs/j' } };

test('#1451: two busy answers then an accepted upload: the file is saved, sent three times, with a wait between', async () => {
  const h = harness([busy, busy, accepted]);
  const stages = [];
  const result = await h.ctx.uploadProjectFile('p', { name: 'notes.md', dataBase64: 'YWJj' }, (v) => stages.push(v.stage));
  assert.equal(result.name, 'notes.md');
  assert.equal(h.attempts.length, 3, 'the same upload is sent again after each busy answer');
  assert.deepEqual(h.delays, [1000, 2000], 'a bounded, growing wait between tries');
  assert.ok(stages.includes('Waiting for another file to finish processing'), 'the wait is shown, not silent');
  assert.equal(stages.at(-1), 'Saved');
});

test('#1451: a busy answer on every try gives up after the last bounded retry, with the server\'s own message and status', async () => {
  const h = harness([busy, busy, busy, busy, busy, busy]);
  await assert.rejects(h.ctx.uploadProjectFile('p', { name: 'notes.md', dataBase64: 'YWJj' }), (err) => {
    assert.equal(err.message, busy.body.error);
    assert.equal(err.status, 429);
    return true;
  });
  assert.equal(h.attempts.length, 5, 'one try, then four bounded retries');
  assert.deepEqual(h.delays, [1000, 2000, 4000, 8000]);
});

test('#1451: any other refusal is not retried, and keeps its own message and code', async () => {
  const h = harness([{ status: 400, body: { error: 'Source is empty; nothing to save.', code: 'empty' } }]);
  await assert.rejects(h.ctx.uploadProjectFile('p', { name: 'empty.txt', dataBase64: '' }), (err) => {
    assert.equal(err.message, 'Source is empty; nothing to save.');
    assert.equal(err.code, 'empty');
    assert.equal(err.status, 400);
    return true;
  });
  assert.equal(h.attempts.length, 1);
  assert.deepEqual(h.delays, []);
});

test('#1451: the busy wait is reported with a stage key, so the screen words it in the interface language', async () => {
  const h = harness([busy, accepted]);
  const progress = [];
  await h.ctx.uploadProjectFile('p', { name: 'notes.md', dataBase64: 'YWJj' }, (v) => progress.push(v));
  const wait = progress.find((v) => v.stageKey === 'busy');
  assert.ok(wait, 'the busy stage carries its key');
  assert.equal(wait.stage, 'Waiting for another file to finish processing', 'English stays as the fallback text');
  assert.ok(progress.some((v) => v.stageKey === 'received') && progress.some((v) => v.stageKey === 'saved'));
});
