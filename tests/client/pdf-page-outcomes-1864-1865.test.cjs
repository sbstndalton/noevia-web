'use strict';
// #1864/#1865: where a large PDF stopped ("stopped at page N (limit)") and what each page's OCR retry came to
// ("OCR retry failed: reason", recovered, found no text, unavailable, not retried) are shown in the source's
// status line and in the indexing-problems toast, in every interface locale. Real catalogues and
// source-status.ts loaded from source; synthetic names and reasons only.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(file) {
  file = path.posix.normalize(file);
  if (cache[file]) return cache[file];
  const exports_ = {}; cache[file] = exports_;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const here = path.posix.dirname(file);
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, Error, console, Promise, TextEncoder, Set, JSON, String, Array,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const core = load('i18n/core');
const FILES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(FILES)) core.registerCatalogue(locale, load(`i18n/${locale}`)[name]);
const LOCALES = ['en-GB', ...Object.keys(FILES)];
const tFor = (locale) => (key, params) => core.translate(locale, key, params);
const status = load('source-status');

const NOTES = [
  { id: 'stoppedAtPage', params: { page: 1000, limit: 'pages' } },
  { id: 'stoppedAtPage', params: { page: 400, limit: 'text' } },
  { id: 'stoppedAtPage', params: { page: 300, limit: 'extractor' } },
  { id: 'stoppedAtPage', params: { page: 25, limit: 'error', reason: 'SYN-READ-ERROR' } },
  { id: 'ocrRetryFailed', params: { pages: '1, 4', reason: 'SYN-OCR-REASON' } },
  { id: 'ocrRetryEmpty', params: { pages: '2' } },
  { id: 'ocrRetryUnavailable', params: { pages: '3' } },
  { id: 'ocrRetryLimit', params: { pages: '21, 22' } },
  { id: 'ocrRetryRecovered', params: { pages: '5' } },
];

test('every note is worded in every locale, with its numbers and reason, never a key or a placeholder', () => {
  for (const locale of LOCALES) {
    const t = tFor(locale);
    const words = NOTES.map((n) => status.noteText(n, t));
    for (const [i, text] of words.entries()) {
      assert.ok(text.length > 10, `${locale} ${NOTES[i].id}: "${text}"`);
      assert.doesNotMatch(text, /projects\.view\.|\{\w+\}/, `${locale} ${NOTES[i].id}: a key or placeholder leaked: ${text}`);
      for (const v of Object.values(NOTES[i].params).filter((v) => !['pages', 'text', 'extractor', 'error'].includes(v))) assert.ok(text.includes(String(v)), `${locale} ${NOTES[i].id} keeps ${v}: ${text}`);
    }
    assert.equal(new Set(words).size, words.length, `${locale}: each note reads differently`);
    if (locale !== 'en-GB') assert.notEqual(words[0], status.noteText(NOTES[0], tFor('en-GB')), `${locale} is translated`);
  }
});

test('English (no translator and en-GB) matches the server\'s own words', () => {
  assert.equal(status.noteText(NOTES[0]), 'stopped at page 1000 (page limit)');
  assert.equal(status.noteText(NOTES[0], tFor('en-GB')), 'stopped at page 1000 (page limit)');
  assert.equal(status.noteText(NOTES[3]), 'stopped at page 25 (read error: SYN-READ-ERROR)');
  assert.equal(status.noteText(NOTES[4]), 'pages 1, 4: OCR retry failed: SYN-OCR-REASON');
  assert.equal(status.noteText({ id: 'somethingNew', params: {} }), '', 'an unknown id is skipped, not shown raw');
});

const doc = (extra) => ({ name: 'Synthetic/doc.pdf', chars: 100, document: { state: 'partial', pages: 3, indexing: 'ready', pageStatus: [], ...extra } });

test('the source status line shows where reading stopped and each retry outcome', () => {
  const large = doc({ pages: 1200, truncated: true, stoppedAt: { page: 1000, limit: 'pages' } });
  assert.match(status.sourceStatus(large), /Partially extracted · 1200 pages · extraction\/summary limited · stopped at page 1000 \(page limit\)/);
  assert.match(status.sourceStatus(large, tFor('de-DE')), /bei Seite 1000 angehalten \(Seitenlimit\)/);
  const form = doc({ pageStatus: [{ number: 1, status: 'degraded', reason: 'native-fallback', retry: { outcome: 'failed', error: 'SYN-OCR-REASON' } }, { number: 2, status: 'native' }] });
  assert.match(status.sourceStatus(form, tFor('en-GB')), /pages 1: OCR retry failed: SYN-OCR-REASON/);
  const recovered = doc({ state: 'ready', pageStatus: [{ number: 1, status: 'ocr', retry: { outcome: 'recovered' } }] });
  assert.match(status.sourceStatus(recovered, tFor('en-GB')), /Text ready · OCR used; verify numbers.*pages 1: recovered by an OCR retry/);
  // A normal document is unchanged.
  const normal = doc({ state: 'ready', pages: 2, pageStatus: [{ number: 1, status: 'native' }, { number: 2, status: 'native' }] });
  assert.equal(status.sourceStatus(normal, tFor('en-GB')), 'Native text ready · 2 pages');
});

test('documentNotes groups failed pages by reason, as the server does', () => {
  const d = doc({ pageStatus: [1, 2, 3].map((n) => ({ number: n, status: 'degraded', retry: { outcome: 'failed', error: n === 2 ? 'B' : 'A' } })) }).document;
  assert.deepEqual(JSON.parse(JSON.stringify(status.documentNotes(d))), [
    { id: 'ocrRetryFailed', params: { pages: '1, 3', reason: 'A' } }, { id: 'ocrRetryFailed', params: { pages: '2', reason: 'B' } }]);
});

test('the toast words the server\'s notes in the interface language, and keeps the server reason otherwise', () => {
  const entry = { folder: '/Synthetic', file: 'Synthetic/large.pdf', reason: 'partial; 1200 pages; stopped at page 1000 (page limit).',
    reasonBase: 'partial; 1200 pages.', notes: [{ id: 'stoppedAtPage', params: { page: 1000, limit: 'pages' } }] };
  assert.deepEqual(status.sourceRefreshEntries([entry], tFor('de-DE')), ['Synthetic/large.pdf: partial; 1200 pages; bei Seite 1000 angehalten (Seitenlimit).']);
  assert.deepEqual(status.sourceRefreshEntries([entry], tFor('en-GB')), ['Synthetic/large.pdf: partial; 1200 pages; stopped at page 1000 (page limit).']);
  assert.deepEqual(status.sourceRefreshEntries([entry]), ['Synthetic/large.pdf: partial; 1200 pages; stopped at page 1000 (page limit).'], 'no translator: the server reason');
  const failed = { ...entry, reasonBase: 'partial.', notes: [{ id: 'ocrRetryFailed', params: { pages: '1', reason: 'OCR is busy; refresh to retry.' } }] };
  assert.deepEqual(status.sourceRefreshEntries([failed], tFor('en-GB')), ['Synthetic/large.pdf: partial; pages 1: OCR retry failed: OCR is busy; refresh to retry.'], 'one full stop');
  const old = { folder: '/Synthetic', file: 'Synthetic/old.pdf', reason: 'partial; 3 pages.' };
  assert.deepEqual(status.sourceRefreshEntries([old], tFor('de-DE')), ['Synthetic/old.pdf: partial; 3 pages.'], 'an entry without notes is as before');
});
