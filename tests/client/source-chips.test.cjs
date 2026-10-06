'use strict';
// #552: the chips under a project reply, and the display name shared with the context panel.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const load = (file) => { const exports = {}; vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require }); return exports; };
const { sourceChips, displayName } = load('src/source-chips.ts');

test('a synced file shows its own name, not the storage path that goes stale on a project rename', () => {
  assert.equal(displayName('noevia projects/Old name/Text/longline.txt'), 'longline.txt');
  assert.equal(displayName('note-a.md'), 'note-a.md');
});

test('one chip per file in prompt order; a file that left the project is marked unavailable', () => {
  const sources = [
    { id: 'a', file: 'note-b.md', snippet: 'first', kind: 'excerpt' },
    { id: 'a', file: 'docs/note-a.md', snippet: 'second', kind: 'excerpt' },
    { id: 'a', file: 'note-b.md', snippet: 'again', kind: 'excerpt' },
    { id: 'g', file: 'deleted.md', snippet: 'x', kind: 'file' },
  ];
  const chips = sourceChips(sources, [{ name: 'note-b.md' }, { name: 'docs/note-a.md' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(chips.map((c) => [c.label, c.available, c.snippet]))), [['note-b.md', true, 'first'], ['note-a.md', true, 'second'], ['deleted.md', false, 'x']]);
  assert.equal(sourceChips(undefined, undefined).length, 0);
});

test('the sources event is stored on the reply, saved with the turn and restored on reload', () => {
  const app = read('src/App.tsx');
  assert.match(app, /ev\.type === 'sources' && Array\.isArray\(ev\.sources\)/);
  assert.equal((app.match(/sources: h\.sources/g) || []).length, 2, 'both history loaders restore sources');
  assert.match(app, /sources: m\.sources && m\.sources\.length \? m\.sources : undefined/);
});

test('the chips are keyboard-reachable buttons that open the project Sources tab', () => {
  const chips = read('src/components/SourceChips.tsx');
  assert.match(chips, /<button type="button" className="chip reply-source-chip"/);
  assert.match(read('src/components/ChatView.tsx'), /<SourceChips sources=\{m\.sources\}/);
  assert.match(read('src/App.tsx'), /setProjectTab\(\{ id: projectId, tab: 'sources' \}\)/);
});
