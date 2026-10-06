'use strict';
// #793: a meta patch from a reply (route_remembered, a [[link]]) goes to the list that holds the
// chat now, not the one the reply was sent from: an accepted frame can move it mid-reply.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/chat-home.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exports_ });
const { chatHome } = exports_;

test('the chat\'s meta decides its list', () => {
  assert.equal(chatHome('c1', [{ id: 'c1', projectId: 'p-new' }], new Map(), null), 'p-new');
  assert.equal(chatHome('c1', [{ id: 'c1', projectId: null }], new Map([['c1', 'p-old']]), 'p-sent'), null);
  assert.equal(chatHome('c1', [{ id: 'c1' }], new Map(), 'p-sent'), null, 'a free chat meta has no projectId');
});

test('before its meta is listed, a move this tab made wins over the list it was sent from', () => {
  assert.equal(chatHome('c1', [], new Map([['c1', 'p-moved']]), null), 'p-moved');
  assert.equal(chatHome('c1', [], new Map([['c1', null]]), 'p-sent'), null, 'moved out of a project into the free list');
});

test('with nothing known, the caller\'s list is kept (the behaviour before #793)', () => {
  assert.equal(chatHome('c1', [{ id: 'other', projectId: 'p-x' }], new Map([['other', 'p-y']]), 'p-sent'), 'p-sent');
  assert.equal(chatHome('c1', [], new Map(), null), null);
});
