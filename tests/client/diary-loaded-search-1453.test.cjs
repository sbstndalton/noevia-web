// #1453 (owner decision (b)): the Diary view searches the days it has already loaded, and nothing else.
// There is no server index and no new request: the search reads only what the view holds in memory, and
// its query and results never leave the page or touch storage. Covers the pure merge and search rules, the
// component's initial render through Vite's SSR pipeline, and a source contract on the no-network rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

async function withModule(name, fn) {
  const { createServer } = require('./vite-ssr-server.cjs');
  const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), server: { middlewareMode: true }, appType: 'custom', plugins: [(await import('@vitejs/plugin-react')).default()] });
  global.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} };
  global.document = { documentElement: { dataset: {}, lang: '' } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(global, 'navigator', { value: { language: 'en-GB', languages: ['en-GB'] }, configurable: true, writable: true });
  try {
    // The Diary segment is registered by its lazy chunk in the app; register it here so the strings resolve.
    const core = await server.ssrLoadModule('/src/i18n/core.ts');
    core.registerSegment('diary', 'en-GB', (await server.ssrLoadModule('/src/i18n/diary/en-GB.ts')).EN_GB_DIARY);
    return await fn(await server.ssrLoadModule(name));
  } finally {
    delete global.window; delete global.document; delete global.localStorage; delete global.navigator;
    await server.close();
  }
}

const SYNTHETIC = {
  '2026-01-03': 'Planted tomatoes today.\nWatered the beans.',
  '2026-02-10': 'Visited the dentist. Tomatoes were mentioned again.',
  '2026-02-11': 'Quiet day.',
};

test('merging keeps every loaded month, replaces a changed day and drops a day that became empty', () => withModule('/src/diary-loaded-search.ts', ({ mergeLoadedDays }) => {
  const loaded = mergeLoadedDays({}, { '2026-01-03': 'first' });
  const more = mergeLoadedDays(loaded, { '2026-02-10': 'second' });
  assert.deepEqual(more, { '2026-01-03': 'first', '2026-02-10': 'second' }, 'an earlier month stays loaded when another is opened');
  const edited = mergeLoadedDays(more, { '2026-02-10': 'second, edited' });
  assert.equal(edited['2026-02-10'], 'second, edited');
  const emptied = mergeLoadedDays(edited, { '2026-01-03': '   ' });
  assert.equal(emptied['2026-01-03'], undefined, 'a deleted entry no longer matches');
  assert.equal(emptied['2026-02-10'], 'second, edited');
}));

test('merging returns the same object when nothing changed, so the view does not re-render', () => withModule('/src/diary-loaded-search.ts', ({ mergeLoadedDays }) => {
  const loaded = { '2026-01-03': 'same' };
  assert.equal(mergeLoadedDays(loaded, { '2026-01-03': 'same' }), loaded);
  assert.equal(mergeLoadedDays(loaded, {}), loaded);
  assert.equal(mergeLoadedDays(loaded, { '2026-09-09': '' }), loaded, 'an empty unknown day adds nothing');
}));

test('search finds text case-insensitively in loaded days only, newest first, with a snippet', () => withModule('/src/diary-loaded-search.ts', ({ searchLoadedDays }) => {
  const hits = searchLoadedDays(SYNTHETIC, 'TOMATO');
  assert.deepEqual(hits.map(h => h.day), ['2026-02-10', '2026-01-03'], 'newest first');
  assert.match(hits[0].snippet, /Tomatoes were mentioned/i);
  assert.match(hits[1].snippet, /Planted tomatoes today\. Watered the beans\./, 'line breaks are flattened');
  assert.deepEqual(searchLoadedDays(SYNTHETIC, 'nothing here'), []);
}));

test('a blank query finds nothing, and the result count is capped', () => withModule('/src/diary-loaded-search.ts', ({ searchLoadedDays }) => {
  assert.deepEqual(searchLoadedDays(SYNTHETIC, '   '), []);
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`2026-03-${String(i % 28 + 1).padStart(2, '0')}-${i}`, 'needle']));
  assert.equal(searchLoadedDays(many, 'needle').length, 50);
  assert.equal(searchLoadedDays(many, 'needle', 3).length, 3);
}));

test('the search field renders its scope note and no results before a query', () => withModule('/src/components/DiaryLoadedSearch.tsx', (mod) => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(mod.DiaryLoadedSearch, { loaded: SYNTHETIC, onOpen() {} }));
  assert.match(html, /type="search"/);
  assert.match(html, /Searches only the months you have opened in this session/);
  assert.doesNotMatch(html, /diary-loaded-search-hits/);
}));

test('the search makes no request and stores nothing: the component and its rules touch no network or storage', () => {
  for (const file of ['components/DiaryLoadedSearch.tsx', 'diary-loaded-search.ts']) {
    const src = read(file);
    assert.doesNotMatch(src, /\bfetch\(|apiFetch|XMLHttpRequest|WebSocket|sendBeacon/, `${file} makes no request`);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/, `${file} stores nothing`);
  }
});

test('the Diary view feeds the search from every day text it loads and opens a picked day', () => {
  const view = read('components/DiaryView.tsx');
  assert.match(view, /const \[loadedDays, setLoadedDays\] = useState<LoadedDays>\(\{\}\);/);
  assert.match(view, /useEffect\(\(\) => \{ setLoadedDays\(prev => mergeLoadedDays\(prev, days\)\); \}, \[days\]\);/);
  assert.match(view, /<DiaryLoadedSearch loaded=\{loadedDays\} onOpen=\{\(picked\) => navigate\(picked\.slice\(0, 7\), picked\)\} \/>/);
});
