// #1579: the project chat list shows the stored title as it is. The same first message used to store the
// 80-character cut, which fit its row, so the row had no ellipsis. The stored title now ends at a word with
// an ellipsis (the derivation is in chat-title.ts, shared with the #1601 fix).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const result = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/chat-title.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: result });

test('#1579 the project chat list title for a long first message ends at a word with an ellipsis', () => {
  const text = 'Which source files mention a code word like HERON or ZEBRA? List the file name and the line number for each match, then summarise them.';
  const title = result.deriveChatTitle(text);
  assert.equal(title, 'Which source files mention a code word like HERON or ZEBRA? List the file name…');
  assert.equal(title.length, 79);
  assert.ok(!title.endsWith(' a'), 'no half-word cut');
});

test('#1579 the project list renders the stored title as is, so the derived ellipsis is what shows', () => {
  const projectView = fs.readFileSync(path.join(__dirname, '../../src/components/ProjectView.tsx'), 'utf8');
  assert.match(projectView, /<span className="chat-index-title">[\s\S]*?<span>\{c\.title \|\| t\('projects\.view\.newTask'\)\}<\/span>/);
});
