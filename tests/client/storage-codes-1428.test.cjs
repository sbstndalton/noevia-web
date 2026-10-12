'use strict';
// #1428: storage failures carry their own codes (storageForbidden, storageThrottled, storageTimeout,
// storageUnreachable, storageLoginRejected) and are worded in every interface locale; #1429: only the
// person's own "Refresh from storage" press sends X-Cowork-Storage-Retry: 1. Real catalogues and
// source-status.ts loaded from source; synthetic codes and folder names only.
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
  vm.runInNewContext(code, { exports: exports_, Intl, Map, Number, Object, Error, console, Promise, TextEncoder, Set, JSON, String,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(path.posix.join(here, m)); } });
  return exports_;
}

const core = load('i18n/core');
const FILES = { 'de-DE': 'DE_DE', 'es-ES': 'ES_ES', 'fr-FR': 'FR_FR', 'it-IT': 'IT_IT', 'nb-NO': 'NB_NO', 'nl-NL': 'NL_NL', 'pt-BR': 'PT_BR', 'sv-SE': 'SV_SE' };
for (const [locale, name] of Object.entries(FILES)) core.registerCatalogue(locale, load(`i18n/${locale}`)[name]);
const LOCALES = ['en-GB', ...Object.keys(FILES)];
const tFor = (locale) => (key, params) => core.translate(locale, key, params);
const status = load('source-status');
const CODES = ['storageLoginRejected', 'storageForbidden', 'storageThrottled', 'storageTimeout', 'storageUnreachable'];

test('#1428 each storage code has its own words, in every locale, never the raw key', () => {
  for (const locale of LOCALES) {
    const t = tFor(locale);
    const words = CODES.map((code) => status.storageCodeText(code, t));
    for (const [i, text] of words.entries()) {
      assert.ok(text.length > 20, `${locale} ${CODES[i]}: "${text}"`);
      assert.doesNotMatch(text, /^storage\.|\{\w+\}/, `${locale} ${CODES[i]}: a key or placeholder leaked`);
    }
    assert.equal(new Set(words).size, CODES.length, `${locale}: the five codes read differently`);
  }
});

test('#1428 an unknown or missing code gives no code words (the caller keeps its own sentence)', () => {
  assert.equal(status.storageCodeText('storageSomethingNew', tFor('en-GB')), '');
  assert.equal(status.storageCodeText(undefined), '');
  assert.match(status.storageCodeText('storageForbidden'), /Storage refused access to this folder/);
});

test('#1428 a skipped source names its code in the interface language, and keeps the older sentences', () => {
  const t = tFor('de-DE');
  const [entry] = status.sourceRefreshEntries([{ folder: 'Reports', file: 'q3.md', reason: 'storage returned 403', code: 'storageForbidden', retained: true }], t);
  assert.equal(entry, `q3.md: ${status.storageCodeText('storageForbidden', t)} Previous readable text retained.`);
  assert.doesNotMatch(entry, /storage returned 403/);
  const [login] = status.sourceRefreshEntries([{ folder: 'Reports', reason: 'storage returned 401' }], tFor('en-GB'));
  assert.equal(login, 'Reports: Storage login rejected. Check your storage credentials in Settings → Diary & storage.');
  assert.equal(status.sourceRefreshEntries([{ folder: 'Reports', reason: 'could not list folder' }])[0], 'Reports: could not list folder');
});

test('#1428 a failed refresh with a code is worded from the code; a plain failure is unchanged', () => {
  const t = tFor('en-GB');
  const err = Object.assign(new Error('Storage is limiting logins'), { code: 'storageThrottled' });
  assert.equal(status.sourceRefreshFailure(err, t), `Sources could not be refreshed — ${status.storageCodeText('storageThrottled', t)}`);
  assert.equal(status.sourceRefreshFailure(new Error('boom'), t), 'Sources could not be refreshed — boom.');
});

test('#1428 an upload refused with a code is worded from the code', () => {
  const t = tFor('fr-FR');
  const err = Object.assign(new Error('Storage refused access'), { code: 'storageTimeout' });
  assert.equal(status.uploadFailureText(err, t, 'fallback'), status.storageCodeText('storageTimeout', t));
  assert.equal(status.uploadFailureText(new Error('Upload failed'), t, 'fallback'), 'Upload failed');
});

// #1429: a source-level contract. The explicit header is set by syncProjectSources only when asked, and
// only the "Refresh from storage" button asks; the automatic refresher never does.
test('#1429 only the explicit Refresh from storage press sends X-Cowork-Storage-Retry: 1', () => {
  const api = fs.readFileSync(path.join(SRC, 'api.ts'), 'utf8');
  assert.match(api, /options\.storageRetry \? \{ \[STORAGE_RETRY_HEADER\]: '1' \} : \{\}/);
  assert.match(api, /export const syncProjectSources = \(id: string, options: \{ storageRetry\?: boolean \} = \{\}\) =>/);
  const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  assert.match(app, /refresh: \(\) => syncProjectSources\(sourceProjectId\),/, 'the automatic refresher sends no option');
  assert.match(app, /syncProjectSources\(projectId, \{ storageRetry: options\.storageRetry === true \}\)/);
  const view = fs.readFileSync(path.join(SRC, 'components/ProjectView.tsx'), 'utf8');
  assert.match(view, /onSave\(project\.id, \{sourceFolders: folders\}, \{ storageRetry: true \}\)/);
  assert.equal((view.match(/storageRetry: true/g) || []).length, 1, 'one explicit press, not more');
  // #1589: saving the project settings dialog is the person's own action too; the automatic refresher still sends none.
  assert.match(app, /onSave=\{\(patch\) => saveProjectAndSync\(p\.id, patch, \{ storageRetry: true \}\)\}/);
  assert.equal((app.match(/storageRetry: true/g) || []).length, 1, 'only the settings dialog save, besides ProjectView');
});

test('#1428 the API keeps the server code on a failed request', () => {
  const api = fs.readFileSync(path.join(SRC, 'api.ts'), 'utf8');
  assert.match(api, /async function failureFromResponse\(res: Response, fallback: string\)/);
  assert.match(api, /failureWithCode\(typeof payload\?\.error === 'string' && payload\.error \? payload\.error : `\$\{fallback\}: \$\{res\.status\}`, payload\?\.code\)/);
  assert.match(api, /if \(!res\.ok\) throw await failureFromResponse\(res, `POST \$\{url\} failed`\);/);
});
