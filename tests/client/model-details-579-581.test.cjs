'use strict';
// #579: Details source line, evidence and state label must match what the model is.
// #581: the German models catalogue uses "du" throughout. Source-pattern tests like the other
// library-tab-*.test.cjs files; the browser proof is qa/models-details.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../src/components/models/LibraryTab.tsx'), 'utf8');
const cat = (loc) => fs.readFileSync(path.join(__dirname, '../../src/i18n/models', `${loc}.ts`), 'utf8');

test('chat qualification evidence (and its Recheck) only renders for a model the engine runs', () => {
  assert.match(src, /\{engineControls && <EvidenceList model=\{m\.name\}\/>\}/);
  assert.doesNotMatch(src, /\n\s*<EvidenceList model=\{m\.name\}\/>/, 'no unconditional EvidenceList remains');
});

test('"served from the download cache" is only the fallback for a plain model without a file', () => {
  assert.match(src, /\{missing \? <p className="mm-note" role="status">\{t\('mm\.card\.missingNote'\)\}<\/p>\n\s*: !file && \(system \|\| protectedModel\) \? <p className="mm-note">\{t\('mm\.card\.sidecarSource'\)\}<\/p>\n\s*: !file && <p className="mm-note">\{t\('mm\.card\.fromCache'\)\}<\/p>\}/);
});

test('a missing file reads "File missing" (not "Failed to load") and hides the "model folder" source tag', () => {
  assert.match(src, /\{missing \? t\('mm\.card\.missing'\) : m\.failed \? t\('mm\.card\.failed'\)/);
  assert.match(src, /\{m\.source && !missing && <span>/);
});

test('the new strings exist in every models catalogue', () => {
  for (const loc of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR', 'sv-SE']) {
    for (const k of ['mm.card.missing', 'mm.card.sidecarSource']) assert.ok(cat(loc).includes(`'${k}':`), `${loc} ${k}`);
  }
});

test('#581: German models catalogue has no formal Sie/Ihr address', () => {
  const formal = cat('de-DE').split('\n').filter((l) => /\b(?:wenn|[Ww]ählen|[Ss]tellen|[Ss]peichern|[Gg]eben|[Kk]licken|[Öö]ffnen|[Pp]rüfen|[Ee]ntfernen|[Ss]tarten|[Ll]öschen)\s+Sie\b|\bIhr(?:e|en|em|er|es)?\b|\bIhnen\b/.test(l));
  assert.deepEqual(formal.map((l) => l.trim().slice(0, 60)), []);
  assert.match(cat('de-DE'), /Stelle die Datei wieder her oder entferne das Preset\./);
});
