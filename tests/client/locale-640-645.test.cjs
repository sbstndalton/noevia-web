'use strict';
// #640 (sentences with sizes in the interface language), #643 (every stored sender token, including
// the pending "Auto (Fast/Smart)"), #644 (the reply timer starts at 0 s), #645 (toolset names and French
// wording). Loads the real catalogues and the small pure modules from source, like
// locale-615-634-637.test.cjs. Everything read from disk is under apps/web.
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
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, Error, console, Promise, TextEncoder,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const core = load('i18n/core');
const FILES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(FILES)) core.registerCatalogue(locale, load(`i18n/${locale}`)[name]);
// The Projects and Diary segments (the sentences below live there), registered as their lazy chunks do.
for (const [locale, name] of Object.entries({ 'en-GB': 'EN_GB', ...FILES })) {
  core.registerSegment('projects', locale, load(`i18n/projects/${locale}`)[`${name}_PROJECTS`]);
  core.registerSegment('diary', locale, load(`i18n/diary/${locale}`)[`${name}_DIARY`]);
}
const LOCALES = Object.keys(FILES);
const tFor = (locale) => (key, params) => core.translate(locale, key, params);
const plain = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

// ── #643: every stored sender token is translated ────────────────────────────────────────────────
const labels = load('chat-labels');

test('#643 the known sender tokens are exactly the ones the app stores', () => {
  assert.deepEqual([...labels.SENDER_TOKENS], ['Auto (fast)', 'Auto (smart)', 'Auto (code)', 'Auto (Fast/Smart)', 'Stopped']);
});

test('#643 every known sender token is worded in every locale, with and without the "Assistant · " prefix', () => {
  for (const locale of LOCALES) {
    const t = tFor(locale);
    for (const token of labels.SENDER_TOKENS) {
      for (const stored of [token, `Assistant · ${token}`]) {
        const shown = labels.senderLabelText(t, stored);
        assert.notEqual(shown, stored, `${locale}: "${stored}" is still as stored`);
        assert.doesNotMatch(shown, /Fast\/Smart|\((fast|smart|code)\)|^Stopped$/, `${locale}: "${shown}" still has English`);
      }
    }
    assert.equal(labels.senderLabelText(t, 'Auto (Fast/Smart)'), t('composer.autoFastSmart'), `${locale}: same as the composer's label`);
  }
  assert.equal(labels.senderLabelText(tFor('de-DE'), 'Assistant · Auto (Fast/Smart)'), 'Auto (Schnell/Smart)');
  assert.equal(labels.senderLabelText(tFor('fr-FR'), 'Auto (Fast/Smart)'), 'Auto (Rapide/Intelligent)');
  assert.equal(labels.senderLabelText(tFor('fr-FR'), 'Assistant · Auto (fast)'), 'Auto (Rapide)');
});

test('#643 a model name and an unknown route pass through untouched', () => {
  const t = tFor('de-DE');
  assert.equal(labels.senderLabelText(t, 'Qwen3-8B-Q5_K_M'), 'Qwen3-8B-Q5_K_M');
  assert.equal(labels.senderLabelText(t, 'Auto (vision)'), 'Auto (vision)');
});

// ── #644: the timer starts at 0 s on the render where streaming turns on ───────────────────────────
const { nextStreamStart } = load('stream-start');

test('#644 the start time is taken on the render where streaming turns on, and kept after that', () => {
  const mounted = 1_000;
  assert.equal(nextStreamStart(false, false, mounted, 90_000), mounted, 'idle: unchanged');
  assert.equal(nextStreamStart(false, true, mounted, 91_000), 91_000, 'the first streaming render starts from now, not from the mount time');
  assert.equal(nextStreamStart(true, true, 91_000, 95_000), 91_000, 'tokens arriving do not restart it');
  assert.equal(nextStreamStart(true, false, 91_000, 99_000), 91_000, 'finished: unchanged until the next reply');
  assert.equal(nextStreamStart(false, true, 91_000, 120_000), 120_000, 'the next reply starts again from now');
});

test('#644 ChatView takes the start while rendering, not in an effect', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/ChatView.tsx'), 'utf8');
  assert.match(src, /streamStart\.current = nextStreamStart\(/);
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*if \(streaming\) streamStart\.current/);
});

// ── #645: toolset names, French unit, French "discussion" ─────────────────────────────────────────
const { toolboxCopy, TOOLBOX_LABEL_IDS } = load('toolbox-copy');

test('#645 "Nextcloud Files" and "Nextcloud Sharing" are named in every locale and keep "Nextcloud"', () => {
  assert.ok(TOOLBOX_LABEL_IDS.includes('nextcloud-files') && TOOLBOX_LABEL_IDS.includes('nextcloud-sharing'));
  const english = { 'nextcloud-files': 'Nextcloud Files', 'nextcloud-sharing': 'Nextcloud Sharing' };
  for (const locale of LOCALES) {
    for (const id of Object.keys(english)) {
      const { label } = toolboxCopy(tFor(locale), { id, label: english[id], description: '', source: 'mcp', inApp: true });
      assert.notEqual(label, english[id], `${locale} ${id}`);
      assert.match(label, /Nextcloud/, `${locale} ${id} keeps the product name`);
    }
  }
  const fr = (id) => toolboxCopy(tFor('fr-FR'), { id, label: '', description: '', source: 'mcp', inApp: true }).label;
  assert.equal(fr('nextcloud-files'), 'Fichiers Nextcloud');
  assert.equal(fr('nextcloud-sharing'), 'Partage Nextcloud');
  // A third party's box with the same id is never renamed.
  assert.equal(toolboxCopy(tFor('fr-FR'), { id: 'nextcloud-files', label: 'Their files', description: '', source: 'mcp', inApp: false }).label, 'Their files');
});

test('#645 French uses one word for tokens per second and says "discussion", not "chat de projet"', () => {
  const t = tFor('fr-FR');
  assert.equal(t('stats.tokPerSecUnit'), 'jetons/s');
  assert.match(t('stats.tokensPerSecond', { value: '19,7' }), /jetons\/s$/);
  assert.doesNotMatch(t('tools.reason.codeNeedsProject'), /chat de projet/);
  assert.match(t('tools.reason.codeNeedsProject'), /discussion de projet/);
});

// ── #640: sentences with sizes ────────────────────────────────────────────────────────────────────
const { describeRejection } = load('sources');
const { diaryErrorText } = load('diary-errors');
const number = load('number-format');

test('#640 a rejected source is worded in the interface language with the locale\'s byte units', () => {
  const rejected = [
    { name: 'a.bin', code: 'notText', reason: 'not a text file' },
    { name: 'big.txt', code: 'tooLarge', size: 300 * 1024, limit: 200_000, reason: '300 KB, over the 195 KB limit' },
    { name: 'p.png', code: 'image', reason: 'an image — add it under Images' },
  ];
  const say = (locale) => describeRejection(rejected, tFor(locale), (b) => number.formatBinaryBytes(b, locale));
  assert.equal(describeRejection(rejected), 'a.bin (not a text file), big.txt (300 KB, over the 195 KB limit), p.png (an image — add it under Images)', 'English fallback without a translator');
  const fr = plain(say('fr-FR'));
  assert.match(fr, /big\.txt \(300 Kio, dépasse la limite de 195 Kio\)/, fr);
  assert.match(fr, /a\.bin \(ce n’est pas un fichier texte\)/);
  assert.doesNotMatch(fr, /KB|KiB|over the|not a text file/);
  const de = plain(say('de-DE'));
  assert.match(de, /big\.txt \(300 KiB, über dem Limit von 195 KiB\)/, de);
});

test('#640 every locale has the rejection and Diary limit sentences, with their placeholders', () => {
  const need = { 'projects.reject.tooLarge': ['{size}', '{limit}'], 'projects.reject.image': ['{group}'], 'projects.reject.document': ['{group}'], 'projects.reject.notText': [],
    'diary.limit.nesting': ['{levels}'], 'diary.limit.items': [], 'diary.limit.folder': ['{files}', '{file}', '{total}'], 'diary.limit.fileTooLarge': ['{limit}'], 'diary.limit.recovery': ['{limit}'],
    'code.task.output.truncated': ['{size}'] };
  const seg = (name, locale) => Object.assign({}, load(`i18n/${name}/${locale}`)[`${locale === 'en-GB' ? 'EN_GB' : FILES[locale]}_${name.toUpperCase()}`]);
  for (const locale of ['en-GB', ...LOCALES]) {
    const cat = { ...seg('projects', locale), ...seg('diary', locale), ...(locale === 'en-GB' ? load('i18n/en-GB').EN_GB : load(`i18n/${locale}`)[FILES[locale]]) };
    for (const [key, holes] of Object.entries(need)) {
      assert.ok(cat[key], `${locale} ${key}`);
      for (const hole of holes) assert.ok(cat[key].includes(hole), `${locale} ${key} keeps ${hole}`);
    }
  }
});

test('#640 the local Diary folder limits are worded in the interface language', () => {
  const folder = Object.assign(new Error('Choose a diary folder with at most 500 Markdown files, 512 KiB per file, and 12 MiB total.'), { limit: { code: 'folder', params: { files: 500, fileBytes: 512 * 1024, totalBytes: 12 * 1024 * 1024 } } });
  const big = Object.assign(new Error('Markdown file exceeds the 512 KiB editor limit.'), { limit: { code: 'fileTooLarge', params: { limitBytes: 512 * 1024 } } });
  const recovery = Object.assign(new Error('Browser recovery exceeds 4 MB. Save or discard older conversation text before continuing.'), { limit: { code: 'recovery', params: { limitBytes: 4 * 1024 * 1024 } } });
  for (const locale of LOCALES) {
    const t = tFor(locale);
    for (const e of [folder, big, recovery]) assert.doesNotMatch(plain(diaryErrorText(t, e, locale)), /Markdown file exceeds|Choose a diary|Browser recovery/, locale);
  }
  assert.match(plain(diaryErrorText(tFor('fr-FR'), folder, 'fr-FR')), /au plus 500 fichiers Markdown, 512 Kio par fichier et 12 Mio au total/);
  assert.match(plain(diaryErrorText(tFor('fr-FR'), big, 'fr-FR')), /512 Kio/);
  assert.match(plain(diaryErrorText(tFor('de-DE'), recovery, 'de-DE')), /überschreitet 4 MiB/);
  assert.equal(diaryErrorText(tFor('de-DE'), new Error('Invalid Markdown path'), 'de-DE'), 'Invalid Markdown path', 'any other error keeps its own message');
  assert.equal(diaryErrorText(tFor('de-DE'), 'plain', 'de-DE'), 'plain');
});

test('#640 the real throwers attach the limit, and an English caller still gets the sentence', async () => {
  const workspace = (() => {
    const code = ts.transpileModule(fs.readFileSync(path.join(SRC, 'diary-workspace.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports_ = {};
    vm.runInNewContext(code, { exports: exports_, require: () => ({ apiFetch() {}, cached: (_k, run) => run(), invalidateCachedPrefix() {} }), TextEncoder, DOMException, window: {}, Date, console });
    return exports_;
  })();
  const big = { size: 600 * 1024, name: 'a.md', kind: 'file', getFile: async () => ({ size: 600 * 1024, text: async () => 'x' }) };
  const root = { values: async function* () { yield big; } };
  await assert.rejects(workspace.scanLocal(root), (e) => e.limit?.code === 'folder' && e.limit.params.fileBytes === 512 * 1024 && /512 KiB per file/.test(e.message));
  await assert.rejects(workspace.saveLocal({}, 'a.md', 'é'.repeat(300 * 1024), null), (e) => e.limit?.code === 'fileTooLarge' && /512 KiB editor limit/.test(e.message));
});

// ── #849: a refused storage login in the Diary banner ───────────────────────────────────────────────
test('#849 a Diary request the server tagged storageLoginRejected reads as that in every language, never as a class name', () => {
  const refused = Object.assign(new Error('Storage login rejected. Check your storage credentials in Settings → Diary & storage.'), { name: 'DiaryRequestError', status: 424, code: 'storageLoginRejected' });
  assert.equal(diaryErrorText(tFor('en-GB'), refused, 'en-GB'), 'Storage login rejected. Check your storage credentials in Settings → Diary & storage.');
  for (const locale of LOCALES) {
    const text = diaryErrorText(tFor(locale), refused, locale);
    assert.equal(text, tFor(locale)('storage.refreshLoginRejected'), locale);
    assert.notEqual(text, tFor('en-GB')('storage.refreshLoginRejected'), `${locale} is translated`);
  }
  // Another failure keeps its message without the "DiaryRequestError:" prefix String(error) would add.
  const other = Object.assign(new Error('Diary storage request failed'), { name: 'DiaryRequestError', status: 500 });
  assert.equal(diaryErrorText(tFor('en-GB'), other, 'en-GB'), 'Diary storage request failed');
});
