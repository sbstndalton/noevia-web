// #415: `/api/code/active`'s response is validated once (parseActiveTasks), shared by the header's
// ActiveCodeTasks widget and the Code-mode sidebar, so a malformed body is a status error in both
// places, never a crash of the whole shell.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');

function loadParseActiveTasks() {
  const file = path.join(__dirname, '../../src/components/code/active-tasks.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => { throw new Error('unexpected import'); } });
  return exports.parseActiveTasks;
}

const parseActiveTasks = loadParseActiveTasks();

const TASK = { id: 't1', projectId: 'p1', projectName: 'Synthetic research', title: 'Fix the bug', status: 'running', stage: null, updatedAt: 1000, approvalAction: null };

test('a well-formed body returns its tasks and total', () => {
  const result = parseActiveTasks({ tasks: [TASK], total: 3 });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, 't1');
  assert.equal(result.tasks[0].projectName, 'Synthetic research');
  assert.equal(result.total, 3);
});

test('total defaults to the valid task count when missing or not a number', () => {
  assert.equal(parseActiveTasks({ tasks: [TASK] }).total, 1);
  assert.equal(parseActiveTasks({ tasks: [TASK], total: 'three' }).total, 1);
});

test('entries missing an id or projectId are filtered out, not thrown on', () => {
  const result = parseActiveTasks({ tasks: [TASK, { ...TASK, id: undefined }, { ...TASK, projectId: undefined }, null], total: 4 });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, 't1');
});

for (const body of [undefined, null, {}, { tasks: null }, { tasks: 'nope' }, { tasks: {} }]) {
  test(`a malformed body (${JSON.stringify(body)}) throws — a status error, never a crash of the shell`, () => {
    assert.throws(() => parseActiveTasks(body));
  });
}
