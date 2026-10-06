// Regression for #176: a failing settings-cleanup DELETE must not throw before onDeleted(),
// which used to leave the deleted model stuck on screen (a re-click re-ran the already-succeeded
// file delete and threw again). onDeleted must fire exactly once the files are gone, and a
// settings-cleanup failure must surface as a separate, non-blocking error.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const load = (f) => { const m = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/components/models', f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: m, module: { exports: m } }); return m; };
const s = load('delete-model-sequence.ts');
// vm.runInNewContext gives back objects from a different realm, so a strict deepEqual against
// a same-realm object literal fails on prototype identity alone; round-trip through JSON first.
const J = (v) => JSON.parse(JSON.stringify(v));

test('files ok + settings delete ok -> onDeleted-equivalent outcome, no error', async () => {
  const outcome = await s.runDeleteModelFiles(async () => {}, async () => {});
  assert.deepEqual(J(outcome), { onDeleted: true, error: null });
});

test('files ok, no settings cleanup requested -> no error', async () => {
  const outcome = await s.runDeleteModelFiles(async () => {});
  assert.deepEqual(J(outcome), { onDeleted: true, error: null });
});

test('files ok + settings 409 -> onDeleted true, non-blocking error reported once', async () => {
  let settingsCalls = 0;
  const outcome = await s.runDeleteModelFiles(
    async () => {},
    async () => { settingsCalls++; throw Object.assign(Error('409 conflict'), { status: 409 }); },
  );
  assert.equal(settingsCalls, 1);
  assert.equal(outcome.onDeleted, true);
  assert.match(outcome.error, /settings could not be cleaned up/);
  assert.match(outcome.error, /409 conflict/);
});

test('file delete itself fails -> rejects, settings cleanup never attempted', async () => {
  let settingsCalls = 0;
  await assert.rejects(
    s.runDeleteModelFiles(
      async () => { throw Error('files delete failed'); },
      async () => { settingsCalls++; },
    ),
    /files delete failed/,
  );
  assert.equal(settingsCalls, 0);
});

test('readErrorBody resolves to {} on a non-JSON / empty 4xx body instead of throwing', async () => {
  const r = { status: 404, json: () => Promise.reject(Error('Unexpected end of JSON input')) };
  const body = await s.readErrorBody(r);
  assert.deepEqual(J(body), {});
});

test('readErrorBody passes through a parsed error field', async () => {
  const r = { status: 400, json: () => Promise.resolve({ error: 'bad name' }) };
  const body = await s.readErrorBody(r);
  assert.equal(body.error, 'bad name');
});

test('httpErrorMessage falls back to "HTTP <status>" when there is no error field', () => {
  assert.equal(s.httpErrorMessage(404), 'HTTP 404');
  assert.equal(s.httpErrorMessage(400, 'bad name'), 'bad name');
});
