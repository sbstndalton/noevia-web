'use strict';
// #1441: the composer may say a chat attachment is "ready for your next message" only once the
// server's source job has finished (uploadProjectFile resolves after polling it to done:true).
// While the job is still processing the line says so, the composer stays busy (Send is blocked on
// it), and a job that fails never produces the "ready" wording. Runs the real uploadAttachments
// from ComposerActions.tsx with its collaborators stubbed; synthetic names only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/components/ComposerActions.tsx'), 'utf8');
const body = source.slice(source.indexOf('export async function uploadAttachments'), source.indexOf('/** True only for a drag'));
const js = ts.transpileModule(body.replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(upload) {
  const statuses = [], busy = [];
  const t = Object.assign((key) => key, { plural: (key, _count, params) => `${key}:${params.target}` });
  const ctx = {
    uploadLimit: () => 1e6, fileToBase64: async () => 'cWE=', uploadProjectFile: upload, uploadWaitingReason: () => '', uploadUnreadableReason: () => '',
    uploadFailureText: (err) => String(err.message), formatPercent: String, appLocale: () => 'en-GB', Date, Math, Error,
    // Collaborators added since (#1454 free-name uploads, source-status stage text): pass-throughs here.
    uploadTakenNames: () => [], uploadUnderFreeName: async (name, _taken, up) => ({ name, result: await up(name) }), uploadStageText: (_t, value) => value.stage,
  };
  vm.createContext(ctx); vm.runInContext(js, ctx);
  const sink = { project: { id: 'ctx', name: 'Chat attachments' }, disabled: false, chatOnly: true, onChanged: async () => {}, onBusy: (b) => busy.push(b), onStatus: (s) => statuses.push(s) };
  return { statuses, busy, run: () => ctx.uploadAttachments(sink, [{ name: 'note.md', size: 65 }], t) };
}
const tick = () => new Promise((r) => setImmediate(r));

test('the composer says processing, stays busy and withholds "ready" until the source job is done (#1441)', async () => {
  let finish; const done = new Promise((r) => { finish = r; });
  const h = harness(async (_id, _body, progress) => { progress({ stage: 'Upload received · waiting for processing' }); progress({ stage: 'Extracting text' }); await done; progress({ stage: 'Saved', percent: 100 }); return { name: 'note.md' }; });
  const running = h.run();
  await tick();
  assert.match(h.statuses.at(-1), /Extracting text/);
  assert.deepEqual(h.busy, [true], 'busy while the job runs');
  assert.ok(!h.statuses.some((s) => s.includes('composer.upload.nextMessage')), 'no "ready" before the job is done');
  finish(); await running;
  assert.match(h.statuses.at(-1), /composer\.upload\.saved:composer\.upload\.thisChat · composer\.upload\.nextMessage/);
  assert.deepEqual(h.busy, [true, false]);
});

test('a source job that fails never leaves the "ready" line behind (#1441)', async () => {
  const h = harness(async (_id, _body, progress) => { progress({ stage: 'Extracting text' }); throw new Error('Source processing failed'); });
  await h.run();
  assert.ok(!h.statuses.some((s) => s.includes('composer.upload.nextMessage')));
  // #1250: a batch with nothing kept says it was not saved (it never leads with "Saved").
  assert.match(h.statuses.at(-1), /composer\.upload\.notSaved/);
  assert.deepEqual(h.busy, [true, false]);
});
