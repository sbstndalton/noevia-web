// #658/#659: what the approval card and the reply show. A repeated change is flagged on the card
// (all three actions stay); a Google Drive write names the Drive file; a reply that ended after
// saving a change says so as a note, not as a failed request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = (file) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', 'src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: () => ({}) });
  return exports;
};

test('the pending card carries the Drive kind and the repeat flag; a finished chip keeps the target and whether it was saved', () => {
  const { pendingToolCall, finishedToolCall } = load('tool-call-state.ts');
  const card = pendingToolCall({ type: 'tool_pending', name: 'drive_update_file', args: '{}', id: 'ap-1', target: 'plan.md (id abc)', targetKind: 'drive', repeatOf: true });
  assert.equal(card.targetKind, 'drive');
  assert.equal(card.repeatOf, true);
  const plain = pendingToolCall({ type: 'tool_pending', name: 'x', id: 'ap-2', targetKind: 'elsewhere', repeatOf: 'yes' });
  assert.equal('targetKind' in plain, false, 'an unknown kind is dropped');
  assert.equal('repeatOf' in plain, false);
  const done = finishedToolCall(card, { name: 'drive_update_file', text: 'Updated plan.md (id abc).', applied: true }, 4000);
  assert.deepEqual({ ...done }, { name: 'drive_update_file', args: '{}', result: 'Updated plan.md (id abc).', status: 'done', target: 'plan.md (id abc)', targetKind: 'drive', applied: true });
  const declined = finishedToolCall(card, { name: 'drive_update_file', text: 'ERROR: the user declined to run drive_update_file.', declined: true }, 4000);
  assert.equal(declined.status, 'denied');
  assert.equal('applied' in declined, false);
  // #666 review: only the server's flag says "declined"; a tool's own error text never does.
  assert.equal(finishedToolCall(card, { name: 'synthetic_lookup', text: 'ERROR: the user was not found.' }, 4000).status, 'done');
  assert.equal(finishedToolCall(card, { name: 'drive_update_file', text: 'ERROR: not run.', notRun: true }, 4000).status, 'stopped');
  const app = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
  assert.match(app, /finishedToolCall\(done >= 0 \? tools\[done\] : undefined, \{ name: ev\.name, text: ev\.text, applied: ev\.applied === true, target: ev\.target, declined: ev\.declined === true, notRun: ev\.notRun === true \}/);
  assert.match(app, /ev\.type === 'paused'/, 'a pause is handled before the error branch, as its own event');
  assert.match(app, /const history = modelHistory\(existing\)/);
  assert.match(app, /rerunBase\(msgs, index\)/, 'Retry keeps the record of saved changes');
  assert.match(app, /void handleSend\(chatId, projectId, text, editBase\(msgs, index\)\)/, 'Edit and re-run keeps them too (#658 review)');
  const diary = fs.readFileSync(path.join(__dirname, '../../src/components/DiaryView.tsx'), 'utf8');
  assert.match(diary, /finishedToolCall\(calls\[index\], \{ name: ev\.name, text: ev\.text, applied: ev\.applied === true, target: ev\.target, declined: ev\.declined === true, notRun: ev\.notRun === true \}/, 'Diary chips keep `applied` too');
});

async function withSsr(run) {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom',
    plugins: [(await import('@vitejs/plugin-react')).default()],
  });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = { language: 'en-GB', languages: ['en-GB'] };
  try { await run(server); } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

test('rendered cards: the repeat flag and the Drive file line, with every argument and all three actions', async () => {
  await withSsr(async (server) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ToolCalls } = await server.ssrLoadModule('/src/components/ToolCalls.tsx');
    const render = (call) => renderToStaticMarkup(React.createElement(ToolCalls, { calls: [{ status: 'pending', approvalId: 'ap-1', ...call }] }));
    const repeat = render({ name: 'project_append_file', args: '{"name":"qa-notes.md","text":"\\nZusatz: 2"}', target: 'noevia projects/QA/Text/qa-notes.md', repeatOf: true });
    assert.match(repeat, /This looks like the change you just approved\./);
    assert.match(repeat, /File this changes:/);
    assert.ok(repeat.includes('Zusatz: 2'), 'the arguments are still shown in full');
    for (const label of ['Allow once', 'Decline', 'Allow for this chat']) assert.ok(repeat.includes(`>${label}<`), label);
    const drive = render({ name: 'drive_update_file', args: '{"fileId":"abc","content":"whole file"}', target: 'plan.md (id abc)', targetKind: 'drive' });
    assert.match(drive, /Google Drive file this changes:/);
    assert.ok(drive.includes('plan.md (id abc)'));
    assert.doesNotMatch(drive, /This looks like the change/);
    assert.match(render({ name: 'drive_create_file', args: '{"name":"n.md"}', target: 'n.md', targetKind: 'drive-new' }), /New Google Drive file:/);

    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    const { pausedNoteText } = await server.ssrLoadModule('/src/chat-labels.ts');
    const t = Object.assign((k, p) => core.translate('en-GB', k, p), { plural: (k, c, p) => core.translatePlural('en-GB', k, c, p) });
    assert.equal(pausedNoteText(t, { reason: 'supervision', applied: 1 }), '1 change was saved. Step supervision paused this reply before any further steps.');
    assert.equal(pausedNoteText(t, { reason: 'supervision', applied: 2 }), '2 changes were saved. Step supervision paused this reply before any further steps.');
    assert.equal(pausedNoteText(t, { reason: 'supervision', applied: 0 }), 'Step supervision paused this reply before any further steps. Nothing was changed.');
    assert.equal(pausedNoteText(t, { reason: 'stopped', applied: 1 }), '1 change was saved before this reply ended.');
  });
  const view = fs.readFileSync(path.join(__dirname, '../../src/components/ChatView.tsx'), 'utf8');
  assert.match(view, /m\.paused && <p className="msg-warning msg-paused" role="status" data-testid="reply-paused">/);
});
