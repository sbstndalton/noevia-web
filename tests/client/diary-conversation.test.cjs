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
    { exports, Date, require: name => load(name.replace('./','')) });
  return exports;
}
const { diaryExchangeTarget } = load('diary-conversation');
test('landing send targets the browser-local day across UTC midnight and year rollover', () => {
  const target = diaryExchangeTarget(null, {}, new Date('2027-01-01T02:30:00Z'));
  assert.equal(target.entryDay, '2026-12-31');
  assert.equal(target.month, '2026-12');
  assert.equal(target.entryTime, '2026-12-31T21:30:00-05:00');
});
test('an explicitly selected past day stays selected while the timestamp remains the send time', () => {
  const target = diaryExchangeTarget('2026-08-14', {}, new Date('2026-09-11T02:30:00Z'));
  assert.equal(target.entryDay, '2026-08-14');
  assert.equal(target.month, '2026-08');
  assert.equal(target.entryTime, '2026-09-10T22:30:00-04:00');
});
test('landing and day view reuse only the target day history without modifying stored turns', () => {
  const turns = { home: [{role:'user',content:'obsolete home history'}], '2026-09-09': [{role:'user',content:'other day'}], '2026-09-10': Array.from({length:20}, (_,i)=>({role:i%2?'assistant':'user',content:String(i)})) };
  const before = JSON.stringify(turns);
  const home = diaryExchangeTarget(null, turns, new Date('2026-09-10T22:00:00-04:00'));
  const day = diaryExchangeTarget('2026-09-10', turns, new Date('2026-09-10T22:00:00-04:00'));
  assert.deepEqual(JSON.parse(JSON.stringify(home.history)), turns['2026-09-10'].slice(-16));
  assert.deepEqual(day.history, home.history);
  home.history.push({role:'user',content:'new'});
  assert.equal(JSON.stringify(turns),before);
  assert.equal(diaryExchangeTarget('2026-09-08', turns).history.length,0);
  assert.equal(diaryExchangeTarget(null, {}, new Date('2026-09-10T22:00:00-04:00')).history.length,0);
});

test('provider reasoning stays in the display transcript and out of subsequent history', () => {
  const turns = {'2026-09-10': [{role:'assistant',content:'Answer',reasoning:'Provider reasoning'}]};
  const {history} = diaryExchangeTarget('2026-09-10', turns);
  assert.equal(history[0].content, 'Answer');
  assert.equal(history[0].reasoning, undefined);
  assert.equal(turns['2026-09-10'][0].reasoning, 'Provider reasoning');
});
test('#664 Diary history carries applied writes after their assistant turn, and only applied ones', () => {
  const turns = { '2026-09-10': [
    { role: 'user', content: 'log it' },
    { role: 'assistant', content: 'done', tools: [
      { name: 'extras_write', result: 'saved', applied: true, target: 'notes/a.md', args: '{"x":1}' },
      { name: 'extras_write', result: 'declined', applied: false },
      { name: 'extras_read', result: 'ok' },
    ] },
    { role: 'user', content: 'again' },
  ] };
  const { history } = diaryExchangeTarget('2026-09-10', turns, new Date('2026-09-10T15:00:00Z'));
  assert.deepEqual(JSON.parse(JSON.stringify(history)), [
    { role: 'user', content: 'log it' },
    { role: 'assistant', content: 'done' },
    { role: 'tool', name: 'extras_write', content: 'saved', applied: true, target: 'notes/a.md', args: '{"x":1}' },
    { role: 'user', content: 'again' },
  ]);
});
