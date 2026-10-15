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
  // #1517: the load, the merged copy and the saved form share one mapping in transcript-variants.ts.
  const mapping = read('src/transcript-variants.ts');
  assert.match(app, /ev\.type === 'sources' && Array\.isArray\(ev\.sources\)/);
  assert.equal((mapping.match(/sources: h\.sources/g) || []).length, 1, 'the shared loader restores sources for the load and the merge');
  assert.match(mapping, /sources: m\.sources && m\.sources\.length \? m\.sources : undefined/);
});

test('the chips are keyboard-reachable buttons that open the project Sources tab', () => {
  const chips = read('src/components/SourceChips.tsx');
  assert.match(chips, /<button type="button" className="chip reply-source-chip"/);
  assert.match(read('src/components/ChatView.tsx'), /<SourceChips sources=\{m\.sources\}/);
  assert.match(read('src/App.tsx'), /setProjectTab\(\{ id: projectId, tab: 'sources' \}\)/);
});

test('same-named files get the shortest tail that tells them apart; the full path rides along (#1809)', () => {
  const { distinguishingNames } = load('src/source-chips.ts');
  const names = ['readme.md', 'docs/readme.md', 'docs/api/auth.md', 'a/docs/readme.md', 'solo.md'];
  const labels = Object.fromEntries(JSON.parse(JSON.stringify([...distinguishingNames(names)])));
  assert.deepEqual(labels, { 'readme.md': 'readme.md', 'docs/readme.md': 'docs/readme.md', 'docs/api/auth.md': 'auth.md', 'a/docs/readme.md': 'a/docs/readme.md', 'solo.md': 'solo.md' });
  const chips = sourceChips([{ id: 'x', file: 'docs/readme.md', snippet: 's', kind: 'file' }, { id: 'y', file: 'readme.md', snippet: 't', kind: 'file' }], [{ name: 'readme.md' }, { name: 'docs/readme.md' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(chips.map((c) => [c.label, c.path]))), [['docs/readme.md', 'docs/readme.md'], ['readme.md', 'readme.md']]);
});
