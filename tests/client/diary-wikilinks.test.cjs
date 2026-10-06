'use strict';
// Obsidian-style [[links]] in a Diary kept as plain Markdown. The parser never rewrites the
// file; it reports positions, and resolution offers the placements a real vault uses.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/diary-markdown.ts'), 'utf8').replace(/export /g, '');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const ctx = {}; vm.createContext(ctx); vm.runInContext(js, ctx);
// The module runs in a VM, so its arrays are not reference-equal to ours; compare values.
const plain = (value) => JSON.parse(JSON.stringify(value));
const markdownWikiLinks = (text) => plain(ctx.markdownWikiLinks(text));
const wikiLinkCandidates = (...args) => plain(ctx.wikiLinkCandidates(...args));

test('every form a vault actually uses is recognised', () => {
  const text = [
    'A plain [[Note]] and an aliased [[Projects/Plan|the plan]].',
    'A heading [[Note#Morning]] and a block [[2026-09-20#^a1b2c3]].',
    'An embed ![[Figure 1.png]] and a same-file anchor [[#Later today]].',
  ].join('\n');
  const found = markdownWikiLinks(text);
  assert.deepEqual(found.map((l) => [l.target, l.alias, l.heading, l.embed]), [
    ['Note', null, null, false],
    ['Projects/Plan', 'the plan', null, false],
    ['Note', null, 'Morning', false],
    ['2026-09-20', null, '^a1b2c3', false],
    ['Figure 1.png', null, null, true],
    ['', null, 'Later today', false],
  ]);
  // Positions point at the source, and the embed's "!" belongs to the link.
  for (const link of found) assert.equal(text.slice(link.offset, link.offset + link.length).endsWith(']]'), true);
  assert.equal(text.slice(found[4].offset, found[4].offset + found[4].length), '![[Figure 1.png]]');
});

test('code is code, in a fence or inline, exactly as the tag reader treats it', () => {
  const text = ['```', 'not a link: [[Fenced]]', '```', 'inline `[[Backticked]]` stays text, but [[Real]] does not.'].join('\n');
  assert.deepEqual(markdownWikiLinks(text).map((l) => l.target), ['Real']);
});

test('a link resolves from the Diary folder first, then beside the file that names it', () => {
  // Obsidian prefers the copy nearest the vault root when a bare name is ambiguous.
  assert.deepEqual(wikiLinkCandidates('Diary/2026/09/20.md', 'Diary', 'Note'), ['Diary/Note.md', 'Diary/2026/09/Note.md']);
  assert.deepEqual(wikiLinkCandidates('2026-09-20.md', '', 'Ideas/Plan'), ['Ideas/Plan.md']);
  // An explicit .md is not doubled.
  assert.deepEqual(wikiLinkCandidates('a/b.md', '', 'Note.md'), ['Note.md', 'a/Note.md']);
});

test('a link that could escape the vault, or is not Markdown, resolves to nothing', () => {
  for (const target of ['/etc/passwd', '../../secrets', 'a\\b', 'x:y', '', '.hidden', 'a/../../b']) {
    const candidates = wikiLinkCandidates('Diary/2026/09/20.md', 'Diary', target);
    assert.ok(candidates.every((c) => c.startsWith('Diary/')), `${target} escaped: ${candidates}`);
  }
  assert.deepEqual(wikiLinkCandidates('a.md', '', '/root'), []);
  assert.deepEqual(wikiLinkCandidates('a.md', '', 'x'.repeat(400)), []);
});

test('a file full of brackets cannot make the parser run away', () => {
  const text = Array.from({ length: 900 }, (_, i) => `[[Note ${i}]]`).join('\n');
  assert.equal(markdownWikiLinks(text).length, 500);
});

test('the link being typed is recognised only while it is still open', () => {
  const at = (text, caret) => plain(ctx.wikiLinkQueryAt(text, caret));
  assert.deepEqual(at('See [[Mor', 9), { start: 6, query: 'Mor' });
  assert.deepEqual(at('See [[', 6), { start: 6, query: '' });
  assert.equal(at('See [[Morning]] then', 20), null, 'a finished link is not still being typed');
  assert.equal(at('See [[Morning]]', 15), null);
  assert.equal(at('no brackets here', 10), null);
  // The line matters: a bracket on an earlier line is not this line's link.
  assert.equal(at('[[Old\nnew line', 12), null);
  assert.deepEqual(at('a [[b]] and [[c', 15), { start: 14, query: 'c' }, 'the one under the caret wins');
  assert.equal(at(`[[${'x'.repeat(200)}`, 202), null, 'a runaway is not a name');
});

test('a link reads as the file’s own name, and as its path only when that is ambiguous', () => {
  const all = ['Diary/2026-09-20.md', 'Diary/Notes/Plan.md', 'Diary/Work/Plan.md'];
  assert.equal(ctx.wikiLinkNameFor('Diary/2026-09-20.md', 'Diary', all), '2026-09-20');
  assert.equal(ctx.wikiLinkNameFor('Diary/Notes/Plan.md', 'Diary', all), 'Notes/Plan');
  assert.equal(ctx.wikiLinkNameFor('Diary/Work/Plan.md', 'Diary', all), 'Work/Plan');
  assert.equal(ctx.wikiLinkNameFor('note.md', '', ['note.md']), 'note');
});

test('a note’s properties are read, and only the part that is really YAML', () => {
  const front = plain(ctx.readFrontmatter([
    '---',
    'title: A quiet morning',
    'tags: [walk, river]',
    'people:',
    '  - Ada',
    '  - Grace',
    'draft:',
    'quoted: "with: a colon"',
    'this line is not a pair',
    '---',
    '# Body',
  ].join('\n')));
  assert.deepEqual(front.fields, [
    { key: 'title', values: ['A quiet morning'] },
    { key: 'tags', values: ['walk', 'river'] },
    { key: 'people', values: ['Ada', 'Grace'] },
    { key: 'draft', values: [] },
    { key: 'quoted', values: ['with: a colon'] },
  ]);
  assert.deepEqual(front.unparsed, ['this line is not a pair'], 'a line it cannot read is kept, not dropped');
});

test('frontmatter is only frontmatter at the very top, and never rewrites the body', () => {
  assert.equal(ctx.readFrontmatter('# Title\n\n---\nnot: frontmatter\n---\n'), null);
  const text = '---\na: 1\n---\n# Body\n\ntext\n';
  const front = plain(ctx.readFrontmatter(text));
  assert.equal(text.slice(front.bodyStart), '# Body\n\ntext\n');
  assert.equal(ctx.readFrontmatter('no block here'), null);
  // A block that never closes is not a block: the whole file would vanish from the preview.
  assert.equal(ctx.readFrontmatter('---\na: 1\nstill going\n'), null);
});

test('tags written as properties are found, the way a vault actually writes them', () => {
  const tags = (text) => plain(ctx.frontmatterTags(text));
  assert.deepEqual(tags('---\ntags: [Walk, river]\n---\n'), ['walk', 'river']);
  assert.deepEqual(tags('---\ntags:\n  - "#walk"\n  - river/spring\n---\n'), ['walk', 'river/spring']);
  assert.deepEqual(tags('---\ntag: solo\n---\n'), ['solo']);
  assert.deepEqual(tags('---\ntags: walk river\n---\n'), ['walk', 'river'], 'a plain space-separated list is common too');
  assert.deepEqual(tags('---\ntitle: no tags here\n---\n'), []);
  assert.deepEqual(tags('# just a heading\n'), []);
});

test('a template is filled the way Obsidian fills one, and nothing else in it changes', () => {
  const now = new Date(2026, 8, 21, 9, 5);
  const fill = (text, title = 'Morning pages') => ctx.fillTemplate(text, { title, now });
  assert.equal(fill('# {{title}}\nCreated {{date}} at {{time}}'), '# Morning pages\nCreated 2026-09-21 at 09:05');
  assert.equal(fill('{{date:DD/MM/YYYY}} {{time:HH.mm}}'), '21/09/2026 09.05');
  assert.equal(fill('{{ DATE }}'), '2026-09-21', 'case and inner spaces are forgiven, as in Obsidian');
  // Anything that is not one of the three is the owner's text and stays exactly as written.
  assert.equal(fill('{{weather}} and {{date'), '{{weather}} and {{date');
});
