'use strict';
// #587: sizes, chart axes and rates in the Models area are written in the interface locale, not
// with toFixed's always-English "3.3". Covers the shared helper and the model-size formatter.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports_ = {}; vm.runInNewContext(code, { exports: exports_, Intl, Map, Number }); return exports_;
}
const { formatNumber, localizeLeadingNumber, formatCompact } = load('number-format.ts');
const { formatModelSizeGB } = load('model-size.ts');
const NNBSP = ' ';

test('decimal separator follows the locale', () => {
  assert.equal(formatNumber(3.3, 'en-GB', 1), '3.3');
  assert.equal(formatNumber(3.3, 'de-DE', 1), '3,3');
  assert.equal(formatNumber(3.3, 'fr-FR', 1), '3,3');
});

test('grouping follows the locale', () => {
  assert.equal(formatNumber(131072, 'en-GB', 0), '131,072');
  assert.equal(formatNumber(131072, 'de-DE', 0), '131.072');
  assert.equal(formatNumber(131072, 'fr-FR', 0), `131${NNBSP}072`);
  assert.equal(formatNumber(1234.5, 'de-DE', 1), '1.234,5');
});

test('fixed, ranged and default fraction digits', () => {
  assert.equal(formatNumber(8, 'de-DE', 1), '8,0');
  assert.equal(formatNumber(8, 'de-DE', { max: 1 }), '8');
  assert.equal(formatNumber(8.25, 'de-DE', { max: 1 }), '8,3');
  assert.equal(formatNumber(1.2345, 'de-DE'), '1,23');
});

test('an invalid locale falls back instead of throwing', () => {
  assert.equal(typeof formatNumber(1.5, 'not a locale!', 1), 'string');
});

test('a server-formatted quantity keeps its unit and decimal count', () => {
  assert.equal(localizeLeadingNumber('5.3 TB', 'de-DE'), '5,3 TB');
  assert.equal(localizeLeadingNumber('139.7 GB', 'fr-FR'), '139,7 GB');
  assert.equal(localizeLeadingNumber('10 MB/s', 'de-DE'), '10 MB/s');
  assert.equal(localizeLeadingNumber('1500.5 MB', 'de-DE'), '1.500,5 MB');
  assert.equal(localizeLeadingNumber('—', 'de-DE'), '—');
});

test('model sizes use the locale separators', () => {
  assert.equal(formatModelSizeGB(3.3, 'en-GB'), '3.3 GB');
  // #636: the unit is the locale's own name for a gigabyte ("Go" in French), with the locale's own gap.
  const plain = (v) => v.replace(/[  ]/g, ' ');
  assert.equal(plain(formatModelSizeGB(3.3, 'de-DE')), '3,3 GB');
  assert.equal(plain(formatModelSizeGB(3.3, 'fr-FR')), '3,3 Go', 'French says Go, not GB');
  assert.equal(plain(formatModelSizeGB(5300, 'de-DE')), '5.300 GB');
  assert.equal(plain(formatModelSizeGB(5300.04, 'fr-FR')), '5 300 Go');
  assert.equal(plain(formatModelSizeGB(3, 'de-DE')), '3 GB');
  assert.equal(formatModelSizeGB(null, 'de-DE'), null);
  assert.equal(formatModelSizeGB(0, 'de-DE'), null);
});

// #592/#597: percent and duration helpers, in en-GB, de-DE and fr-FR.
const { formatPercent, formatDuration } = load('number-format.ts');
const NUMBER_FORMAT_CODE = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/number-format.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loadWith(intl) { const out = {}; vm.runInNewContext(NUMBER_FORMAT_CODE, { exports: out, Intl: intl, Map, Number, Object, Math }); return out; }

test('percent uses the locale percent format', () => {
  const SP = '[\\u00a0\\u202f]';
  assert.equal(formatPercent(27, 'en-GB'), '27%');
  assert.match(formatPercent(27, 'de-DE'), new RegExp(`^27${SP}%$`));
  assert.match(formatPercent(27, 'fr-FR'), new RegExp(`^27${SP}%$`));
  assert.match(formatPercent(0, 'de-DE'), new RegExp(`^0${SP}%$`));
  assert.match(formatPercent(27.5, 'de-DE', 1), new RegExp(`^27,5${SP}%$`));
  assert.match(formatPercent(27.5, 'fr-FR', 1), new RegExp(`^27,5${SP}%$`));
  assert.match(formatPercent(150, 'de-DE'), new RegExp(`^150${SP}%$`));
  assert.doesNotMatch(formatPercent(27, 'de-DE'), /^27%$/);
});

test('duration keeps the two-unit shape and localises the unit names', () => {
  const de = formatDuration(3600 + 14 * 60 + 5, 'de-DE');
  assert.match(formatDuration(3600 + 14 * 60, 'en-GB'), /^1\s?h(?:ou)?r?,? 14\s?min/i);
  assert.match(de, /1\s?Std\.?,? 14\s?Min/);
  assert.doesNotMatch(de, /\b1h\b/);
  assert.match(formatDuration(13 * 86400 + 15 * 3600, 'fr-FR'), /13\s?j.*15\s?h/);
  assert.match(formatDuration(13 * 86400 + 15 * 3600, 'de-DE'), /13\s?Tg?\.?,? 15\s?Std/);
  assert.match(formatDuration(45, 'de-DE'), /^45\s?Sek/);
  assert.match(formatDuration(600, 'fr-FR'), /^10\s?min/);
  assert.match(formatDuration(-5, 'en-GB'), /^0\s?s/);
  assert.match(formatDuration(Number.NaN, 'en-GB'), /^0\s?s/);
});

test('compact counts use the locale suffix and separator, not an English k/M/B (#600)', () => {
  // ICU versions differ on the exact case and spacing, so match the shape, not the bytes.
  assert.match(formatCompact(1234567, 'en-GB'), /^1\.2\s?m$/i);
  assert.match(formatCompact(2500000000, 'en-GB'), /^2\.5\s?bn?$/i);
  assert.match(formatCompact(1234567, 'de-DE'), /^1,2\s?Mio\.$/);
  assert.match(formatCompact(2500000000, 'de-DE'), /^2,5\s?Mrd\.$/);
  assert.match(formatCompact(1234567, 'fr-FR'), /^1,2\s?M$/);
  assert.match(formatCompact(15000, 'fr-FR'), /^15\s?k$/i);
  // The old hand-built "1.2M" / "2.4M" must never come back for a German reader.
  assert.doesNotMatch(formatCompact(2400000, 'de-DE'), /\d[.]\d/);
  for (const l of ['en-GB', 'de-DE', 'fr-FR']) {
    assert.equal(formatCompact(999, l), '999');
    assert.equal(formatCompact(0, l), '0');
  }
  assert.match(formatCompact(1234567, 'not a locale'), /1/);
});

test('duration falls back to unit formatting, then to English letters', () => {
  const bare = loadWith({ NumberFormat: Intl.NumberFormat });
  assert.match(bare.formatDuration(4440, 'de-DE'), /1\s?Std\.?\s+14\s?Min/);
  const broken = loadWith({ NumberFormat: function (l, o) { if (o && o.style === 'unit') throw new RangeError('no'); return new Intl.NumberFormat(l, o); } });
  assert.equal(broken.formatDuration(4440, 'de-DE'), '1h 14m');
  assert.equal(broken.formatDuration(13 * 86400 + 15 * 3600, 'de-DE'), '13d 15h');
});
