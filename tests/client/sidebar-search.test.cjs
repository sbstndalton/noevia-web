// #439: pure helpers behind the sidebar search box's keyboard navigation and match
// highlighting. No jsdom is installed in this repo, so `sidebar-search.ts` is transpiled and
// run directly (the same technique tests/client/menu-nav.test.cjs already uses) rather than mounting
// a real DOM/React tree.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../../src/sidebar-search.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
// Run in *this* realm (not vm.runInNewContext's separate one) so the plain objects/arrays this
// module builds share this file's Object/Array prototypes — deepEqual below treats a
// same-shape object from a different vm context as unequal (different constructors).
const exports_ = {};
new Function('exports', 'require', code)(exports_, (m) => { throw new Error('unexpected import ' + m); });
const { escapeRegExp, highlightSegments, buildSearchResults, matchingDestinations, searchResultKey } = exports_;

test('escapeRegExp neutralises every regex metacharacter', () => {
  assert.equal(escapeRegExp('a.b('), 'a\\.b\\(');
  assert.equal(escapeRegExp('[test]+*?^${}|\\'), '\\[test\\]\\+\\*\\?\\^\\$\\{\\}\\|\\\\');
  // A regex built from the escaped text must match only the literal string, and must not throw.
  assert.doesNotThrow(() => new RegExp(escapeRegExp('a.b('), 'ig'));
  assert.deepEqual('a.b(c'.match(new RegExp(escapeRegExp('a.b('), 'ig')), ['a.b(']);
});

test('highlightSegments returns the whole text unmatched for an empty query', () => {
  assert.deepEqual(highlightSegments('Synthetic audit', ''), [{ key: 0, text: 'Synthetic audit', match: false }]);
  assert.deepEqual(highlightSegments('Synthetic audit', '   '), [{ key: 0, text: 'Synthetic audit', match: false }]);
});

test('highlightSegments matches case-insensitively and splits around every occurrence', () => {
  const segs = highlightSegments('Audit the Q3 audit report', 'audit');
  assert.deepEqual(segs.map((s) => [s.text, s.match]), [
    ['Audit', true],
    [' the Q3 ', false],
    ['audit', true],
    [' report', false],
  ]);
});

test('highlightSegments never throws on regex-special punctuation, and matches it literally', () => {
  assert.doesNotThrow(() => highlightSegments('a.b(c) and a.b(c) again', 'a.b('));
  const segs = highlightSegments('a.b(c) and a.b(c) again', 'a.b(');
  assert.deepEqual(segs.filter((s) => s.match).map((s) => s.text), ['a.b(', 'a.b(']);
  // A literal "." must not have matched an unrelated character the way an unescaped regex would.
  assert.doesNotThrow(() => highlightSegments('axbc', '.'));
  assert.deepEqual(highlightSegments('axbc', '.').filter((s) => s.match).map((s) => s.text), []);
});

test('highlightSegments returns no match for text that does not contain the query', () => {
  assert.deepEqual(highlightSegments('Synthetic project', 'zzznotfound'), [{ key: 0, text: 'Synthetic project', match: false }]);
});

test('buildSearchResults orders pinned chats, pinned projects, unpinned projects, then recent chats', () => {
  const results = buildSearchResults(
    [{ id: 'pinned-chat-1' }],
    [{ id: 'pinned-project-1' }],
    [{ id: 'project-1' }, { id: 'project-2' }],
    [{ id: 'chat-1' }, { id: 'chat-2' }],
  );
  assert.deepEqual(results, [
    { kind: 'chat', id: 'pinned-chat-1' },
    { kind: 'project', id: 'pinned-project-1' },
    { kind: 'project', id: 'project-1' },
    { kind: 'project', id: 'project-2' },
    { kind: 'chat', id: 'chat-1' },
    { kind: 'chat', id: 'chat-2' },
  ]);
});

test('buildSearchResults tolerates every list being empty', () => {
  assert.deepEqual(buildSearchResults([], [], [], []), []);
});

test('destinations lead the keyboard order while chats and projects keep their order', () => {
  assert.deepEqual(buildSearchResults(
    [{ id: 'c1' }], [{ id: 'p1' }], [{ id: 'p2' }], [{ id: 'c2' }], [{ id: 'diary' }],
  ), [
    { kind: 'destination', id: 'diary' },
    { kind: 'chat', id: 'c1' },
    { kind: 'project', id: 'p1' },
    { kind: 'project', id: 'p2' },
    { kind: 'chat', id: 'c2' },
  ]);
});

test('destination matches use the visible localized label', () => {
  const destinations = [{ id: 'settings', label: 'Einstellungen' }, { id: 'diary', label: 'Tagebuch' }];
  assert.deepEqual(matchingDestinations(destinations, 'STELL'), [destinations[0]]);
  assert.deepEqual(matchingDestinations(destinations, 'diary'), []);
  assert.deepEqual(matchingDestinations(destinations, '  '), []);
});

test('searchResultKey distinguishes a chat and a project sharing the same id', () => {
  assert.notEqual(searchResultKey('chat', 'x'), searchResultKey('project', 'x'));
});
