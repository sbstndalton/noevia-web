'use strict';
// #236: which harness a send goes to, and when a mode switch must become a new session.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require }); return exports; };
const { decideDispatch, sessionMode, parseMode, switchNeedsNewSession } = load('src/chat-mode.ts');
const ok = { mode: 'cowork', harnessEnabled: true, canUseCode: true, projectId: 'p1', repository: 'demo' };

test('Chat always goes to the chat harness, silently', () => {
  assert.deepEqual({ ...decideDispatch({ ...ok, mode: 'chat' }) }, { harness: 'chat', notice: null, reason: null });
});
test('Cowork with harness, admin access, a project and a repository goes to the code harness', () => {
  assert.deepEqual({ ...decideDispatch(ok) }, { harness: 'cowork', notice: null, reason: null });
});
test('every missing precondition falls back to Chat with a one-line reason', () => {
  for (const [patch, reason, code] of [[{ harnessEnabled: false }, /off/, 'harnessOff'], [{ projectId: null }, /project/, 'freeChat'], [{ canUseCode: false }, /administrators/, 'adminOnly'], [{ repository: null }, /repository/, 'noRepository']]) {
    const d = decideDispatch({ ...ok, ...patch });
    assert.equal(d.reason, code, 'a translatable code travels with the English notice');
    assert.equal(d.harness, 'chat');
    assert.match(d.notice, /^Sent as Chat: /);
    assert.match(d.notice, reason);
    assert.equal(d.notice.includes('\n'), false);
  }
});
test('the saved mode wins; an unsent choice applies to a new chat; unknown values are Chat', () => {
  assert.equal(sessionMode('cowork', 'chat'), 'cowork');
  assert.equal(sessionMode(undefined, 'cowork'), 'cowork');
  assert.equal(sessionMode(undefined, undefined), 'chat');
  assert.equal(sessionMode('shell', undefined, 'cowork'), 'cowork');
  assert.equal(parseMode('shell'), 'chat');
});
test('switching mode is in place only before the first message', () => {
  assert.equal(switchNeedsNewSession(0, 'chat', 'cowork'), false);
  assert.equal(switchNeedsNewSession(2, 'chat', 'cowork'), true);
  assert.equal(switchNeedsNewSession(2, 'chat', 'chat'), false);
});
