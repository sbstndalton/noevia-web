// #2601: the sidebar search said it finds pages but asked only /api/chats/search. The server searches a Space's pages one Space at a
// time, so the client asks each of the first Spaces and merges the answers. Pure: space-page-search.ts is transpiled and run with
// stub calls, the same technique sidebar-search.test.cjs uses.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');

const load = (file, requires = {}) => {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports_ = {};
  new Function('exports', 'require', code)(exports_, (m) => { if (m in requires) return requires[m]; throw new Error('unexpected import ' + m); });
  return exports_;
};
const search = load('space-page-search.ts', { './spaces-api': { listSpaces() {}, listPages() {} } });
const { searchSpacePages, PAGE_SEARCH_SPACES, PAGE_SEARCH_PER_SPACE, PAGE_SEARCH_MAX, PAGE_SEARCH_PARALLEL } = search;
const { buildSearchResults, searchResultKey } = load('sidebar-search.ts');

const spaces = (n) => ({ revision: 1, spaces: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `QA space ${i}`, createdAt: 0, updatedAt: 0 })) });
const row = (id, title) => ({ id, title, version: 'v', bytes: 1, createdAt: 0, updatedAt: 0, savedBy: 'you' });

test('a page in a Space is found, with its Space, and the query reaches the server per Space', async () => {
  const calls = [];
  const api = {
    listSpaces: async () => spaces(2),
    listPages: async (id, opts) => { calls.push([id, opts.q, opts.limit]); return { pages: id === 's1' ? [row('p1', 'QA page d1')] : [], truncated: false }; },
  };
  const result = await searchSpacePages('QA page d1', undefined, api);
  assert.deepEqual(result.hits, [{ spaceId: 's1', spaceName: 'QA space 1', pageId: 'p1', title: 'QA page d1' }]);
  assert.equal(result.incomplete, false);
  assert.deepEqual(calls.sort(), [['s0', 'QA page d1', PAGE_SEARCH_PER_SPACE], ['s1', 'QA page d1', PAGE_SEARCH_PER_SPACE]]);
});

test('no Spaces, or no match, is an empty and complete answer', async () => {
  assert.deepEqual(await searchSpacePages('x', undefined, { listSpaces: async () => spaces(0), listPages: async () => { throw new Error('not called'); } }), { hits: [], incomplete: false });
  assert.deepEqual(await searchSpacePages('x', undefined, { listSpaces: async () => spaces(3), listPages: async () => ({ pages: [], truncated: false }) }), { hits: [], incomplete: false });
});

test('only the first Spaces are asked, a few at a time, and the answer says it may be incomplete', async () => {
  let running = 0, peak = 0, asked = 0;
  const api = {
    listSpaces: async () => spaces(PAGE_SEARCH_SPACES + 5),
    listPages: async () => { asked++; running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return { pages: [], truncated: false }; },
  };
  const result = await searchSpacePages('x', undefined, api);
  assert.equal(asked, PAGE_SEARCH_SPACES);
  assert.ok(peak <= PAGE_SEARCH_PARALLEL && peak > 1, `${peak} at once`);
  assert.equal(result.incomplete, true);
});

test('a Space that fails is skipped and the answer is incomplete; the others still show', async () => {
  const api = {
    listSpaces: async () => spaces(3),
    listPages: async (id) => { if (id === 's1') throw new Error('Request failed (500).'); return { pages: [row(`p-${id}`, `QA ${id}`)], truncated: false }; },
  };
  const result = await searchSpacePages('QA', undefined, api);
  assert.deepEqual(result.hits.map((h) => h.pageId), ['p-s0', 'p-s2']);
  assert.equal(result.incomplete, true);
});

test('a Space with more matches than were kept, or too many in all, is incomplete and bounded', async () => {
  const truncated = await searchSpacePages('x', undefined, { listSpaces: async () => spaces(1), listPages: async () => ({ pages: [row('p', 'QA')], truncated: true }) });
  assert.equal(truncated.incomplete, true);
  const many = await searchSpacePages('x', undefined, {
    listSpaces: async () => spaces(10),
    listPages: async (id) => ({ pages: Array.from({ length: 4 }, (_, i) => row(`${id}-${i}`, 'QA')), truncated: false }),
  });
  assert.equal(many.hits.length, PAGE_SEARCH_MAX);
  assert.equal(many.incomplete, true);
});

test('a failed Space list rejects (no pages shown), and an abort stops the lookup', async () => {
  await assert.rejects(searchSpacePages('x', undefined, { listSpaces: async () => { throw new Error('Request failed (404).'); }, listPages: async () => ({ pages: [], truncated: false }) }));
  const controller = new AbortController();
  const api = {
    listSpaces: async () => spaces(2),
    listPages: async (_id, opts) => { controller.abort(); if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError'); return { pages: [], truncated: false }; },
  };
  await assert.rejects(searchSpacePages('x', controller.signal, api), { name: 'AbortError' });
});

test('buildSearchResults lists pages after the destinations and before the chats, keyed by kind', () => {
  const results = buildSearchResults([{ id: 'c1' }], [{ id: 'p1' }], [{ id: 'p2' }], [{ id: 'c2' }], [{ id: 'd1' }], [{ id: 's1/pg1' }, { id: 's2/pg2' }]);
  assert.deepEqual(results.map((r) => searchResultKey(r.kind, r.id)), ['destination:d1', 'page:s1/pg1', 'page:s2/pg2', 'chat:c1', 'project:p1', 'project:p2', 'chat:c2']);
  assert.deepEqual(buildSearchResults([], [], [], [], [], [{ id: 'a/b' }]).map((r) => r.kind), ['page']);
});
