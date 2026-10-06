// #765: a whole-list chat save reports ids another list holds; the client reads them here.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/list-save.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ex = {}; vm.runInNewContext(code, { exports: ex });

test('skippedChatIds: the reported ids, and nothing for an unchanged or malformed reply', () => {
  assert.deepEqual([...ex.skippedChatIds({ ok: true, skipped: ['c1', 'c2'] })], ['c1', 'c2']);
  assert.deepEqual([...ex.skippedChatIds({ ok: true })], []);
  assert.deepEqual([...ex.skippedChatIds({ ok: true, skipped: 'c1' })], []);
  assert.deepEqual([...ex.skippedChatIds({ ok: true, skipped: ['c1', 3, '', null] })], ['c1']);
  assert.deepEqual([...ex.skippedChatIds(undefined)], []);
  assert.deepEqual([...ex.skippedChatIds(null)], []);
});

test('withoutSkipped: drops only the skipped ids, keeps order, same list when none', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(ex.withoutSkipped(list, ['b']).map((c) => c.id), ['a', 'c']);
  assert.equal(ex.withoutSkipped(list, []), list);
});
