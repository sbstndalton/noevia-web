'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PrototypeIndex, benchmark } = require('../../qa/diary-graph-prototype.cjs');

function existingScanner() {
  const source = fs.readFileSync(path.join(__dirname, '../../src/diary-file-search.ts'), 'utf8');
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, TextEncoder,
    require(id) { if (id === './diary-markdown') return require('../../qa/diary-graph-prototype.cjs').markdown; throw Error(id); } });
  return module.exports.searchMarkdownFolder;
}

test('synthetic index backlinks agree with the shipped bounded scanner on a complete fixture', async () => {
  const files = [
    { path: 'Diary/target.md', content: '# Target', revision: 1 },
    { path: 'Diary/relative.md', content: '[target](target.md)', revision: 1 },
    { path: 'Diary/wiki.md', content: '[[target#heading|alias]]', revision: 1 },
    { path: 'Diary/ignored.md', content: '`[target](target.md)`\n```md\n[[target]]\n```', revision: 1 },
    { path: 'Diary/embed.md', content: '![[target]]', revision: 1 },
  ];
  const index = new PrototypeIndex();
  for (const file of files) index.upsert('a', file);
  const scanner = existingScanner();
  const report = await scanner({ path: 'Diary', query: 'Diary/target.md', kind: 'backlinks',
    list: async () => ({ files: files.map(file => ({ path: file.path, name: file.path.split('/').pop(), isDir: false })) }),
    read: async filePath => ({ content: files.find(file => file.path === filePath).content }) });
  assert.equal(report.partial, false);
  const expected = Array.from(report.results, item => item.path).sort();
  assert.deepEqual(index.query('a', 'Diary/target.md').nodes.map(item => item.id), expected);
  assert.deepEqual(expected, ['Diary/embed.md', 'Diary/relative.md', 'Diary/wiki.md']);
});

test('edits, rename, trash, stale generations and source revisions change only the owning tenant', () => {
  const index = new PrototypeIndex();
  index.upsert('a', { path: 'Diary/target.md', content: '# Target', revision: 1 });
  index.upsert('b', { path: 'Diary/target.md', content: '# Other tenant', revision: 1 });
  index.upsert('a', { path: 'Diary/from.md', content: '[go](target.md)', revision: 1 });
  const generation = index.tenant('a').generation;
  assert.deepEqual(index.query('a', 'Diary/target.md').nodes.map(n => n.id), ['Diary/from.md']);
  assert.deepEqual(index.query('b', 'Diary/target.md').nodes, []);
  assert.throws(() => index.upsert('a', { path: 'Diary/from.md', content: 'conflict', revision: 1 }), /revision/);
  index.upsert('a', { path: 'Diary/from.md', content: '# corrected', revision: 2 });
  assert.equal(index.query('a', 'Diary/target.md', { expectedGeneration: generation }).status, 'stale');
  assert.deepEqual(index.query('a', 'Diary/target.md').nodes, []);
  index.remove('a', 'Diary/from.md', 3);
  index.upsert('a', { path: 'Diary/renamed.md', content: '[[target]]', revision: 1 });
  assert.deepEqual(index.query('a', 'Diary/target.md').nodes.map(n => n.id), ['Diary/renamed.md']);
  index.remove('a', 'Diary/target.md', 2);
  assert.equal(index.query('a', 'Diary/target.md').status, 'missing');
  assert.throws(() => index.upsert('a', { path: 'Diary/target.md', content: '# stale replica', revision: 1 }), /revision/);
  assert.equal(index.query('b', 'Diary/target.md').status, 'ok');
  assert.throws(() => index.upsert('a', { path: 'Diary/missing.md', content: '', revision: NaN }), /revision|path/);
  assert.throws(() => index.upsert('a', { path: 'Diary/../escape.md', content: '', revision: 1 }), /path/);
});

test('bounded results disclose partial count and benchmark checks three synthetic scales', () => {
  const index = new PrototypeIndex();
  index.upsert('a', { path: 'Diary/hub.md', content: '', revision: 1 });
  for (let i = 0; i < 35; i++) index.upsert('a', { path: `Diary/${i}.md`, content: '[[hub]]', revision: 1 });
  const result = index.query('a', 'Diary/hub.md', { limit: 10 });
  assert.equal(result.status, 'ok');assert.equal(result.partial, true);assert.equal(result.hidden, 25);
  assert.equal(result.nodes.length, 10);
  const rows = benchmark();
  assert.deepEqual(rows.map(row => row.size), [40, 400, 2000]);
  assert.ok(rows.every(row => row.scanMatchesIndexed && row.files === row.size && row.edges > 0));
});

test('capacity failure and failed rebuild leave a prior complete snapshot readable', () => {
  const index = new PrototypeIndex('Diary', { maxFiles: 2, maxEdges: 2 });
  index.upsert('a', { path: 'Diary/a.md', content: '[b](b.md)', revision: 1 });
  index.upsert('a', { path: 'Diary/b.md', content: '# B', revision: 1 });
  const previous = index.query('a', 'Diary/b.md');
  assert.throws(() => index.upsert('a', { path: 'Diary/c.md', content: '', revision: 1 }), /capacity/);
  assert.throws(() => index.rebuild('a', [{ path: 'Diary/new.md', content: '', revision: 1 }]), /Authoritative/);
  assert.throws(() => index.rebuild('a', [
    { path: 'Diary/new.md', content: '', revision: 1 },
    { path: 'Diary/../bad.md', content: '', revision: 1 },
  ], { authoritative: true }), /path/);
  assert.deepEqual(index.query('a', 'Diary/b.md'), previous);
  const generation = index.rebuild('a', [{ path: 'Diary/new.md', content: '', revision: 1 }], { authoritative: true });
  assert.equal(index.query('a', 'Diary/b.md').status, 'missing');
  assert.equal(index.query('a', 'Diary/new.md').generation, generation);
});
