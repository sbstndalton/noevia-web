'use strict';
// #610: a file size picks its own unit (B, KB, MB, GB) in the interface locale, so a 2 KB note is
// no longer "0.00 MB". Loads the helper from source in isolation, like number-format.test.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/number-format.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ex = {}; vm.runInNewContext(code, { exports: ex, Intl, Map, Number, Math, Object });
const { formatBytes } = ex;
const plain = (s) => s.replace(/[  ]/g, ' ');

test('small files read in bytes and kilobytes, never as 0.00 MB', () => {
  assert.match(plain(formatBytes(110, 'en-GB')), /^110 (B|byte)/);
  assert.equal(plain(formatBytes(2048, 'en-GB')), '2 kB');
  assert.equal(plain(formatBytes(1536, 'en-GB')), '1.5 kB');
  assert.doesNotMatch(formatBytes(2048, 'en-GB'), /0[.,]00/);
  assert.match(plain(formatBytes(0, 'en-GB')), /^0 /);
});

test('the unit steps up at 1024 and stops at terabytes', () => {
  assert.equal(plain(formatBytes(1024 * 1024, 'en-GB')), '1 MB');
  assert.equal(plain(formatBytes(3.3 * 1024 ** 3, 'en-GB')), '3.3 GB');
  assert.equal(plain(formatBytes(5.3 * 1024 ** 4, 'en-GB')), '5.3 TB');
  assert.equal(plain(formatBytes(5.3 * 1024 ** 4, 'fr-FR')), '5,3 To');
  assert.equal(plain(formatBytes(3.3 * 1024 ** 3, 'fr-FR')), '3,3 Go');
  assert.equal(plain(formatBytes(150 * 1024, 'en-GB')), '150 kB');
});

test('separators and unit names follow the locale', () => {
  assert.equal(plain(formatBytes(1536, 'de-DE')), '1,5 kB');
  assert.equal(plain(formatBytes(1.5 * 1024 * 1024, 'de-DE')), '1,5 MB');
  assert.equal(plain(formatBytes(2048, 'fr-FR')), '2 ko');
  assert.equal(plain(formatBytes(1.5 * 1024 * 1024, 'fr-FR')), '1,5 Mo');
});

test('bad input and an unknown locale still give text', () => {
  assert.match(plain(formatBytes(NaN, 'en-GB')), /^0 /);
  assert.match(plain(formatBytes(-5, 'en-GB')), /^0 /);
  assert.match(formatBytes(2048, 'xx-invalid-locale-zz'), /2/);
});

// #653: CLDR's SHORT English byte is "byte" for every count ("109 byte"). The byte tier is spelled out and
// inflected by the locale's own plural rules instead; kilobytes and up keep their symbols.
test('#653 a size under 1 KB reads with a correct singular and plural in every shipped locale', () => {
  const expected = {
    'en-GB': ['1 byte', '109 bytes'], 'en-US': ['1 byte', '109 bytes'],
    'de-DE': ['1 Byte', '109 Byte'], 'fr-FR': ['1 octet', '109 octets'],
    es: ['1 byte', '109 bytes'], 'pt-BR': ['1 byte', '109 bytes'],
    it: ['1 byte', '109 byte'], nl: ['1 byte', '109 byte'], nb: ['1 byte', '109 byte'], sv: ['1 byte', '109 byte'],
  };
  for (const [locale, [one, many]] of Object.entries(expected)) {
    assert.equal(plain(formatBytes(1, locale)), one, `${locale} singular`);
    assert.equal(plain(formatBytes(109, locale)), many, `${locale} plural`);
  }
  assert.doesNotMatch(plain(formatBytes(109, 'en-GB')), /109 byte$/, 'the bug: "109 byte"');
  assert.equal(plain(formatBytes(0, 'en-GB')), '0 bytes');
  // The tier above is untouched.
  assert.equal(plain(formatBytes(1024, 'en-GB')), '1 kB');
  assert.equal(plain(formatBytes(2048, 'fr-FR')), '2 ko');
});

test('#653 the binary sizes name a byte with a symbol, which has no plural to get wrong', () => {
  const { formatBinaryBytes } = ex;
  assert.equal(plain(formatBinaryBytes(1, 'en-GB')), '1 B');
  assert.equal(plain(formatBinaryBytes(109, 'en-GB')), '109 B');
  assert.equal(plain(formatBinaryBytes(109, 'de-DE')), '109 B');
  assert.equal(plain(formatBinaryBytes(109, 'fr-FR')), '109 o');
  assert.doesNotMatch(plain(formatBinaryBytes(109, 'en-GB')), /byte/i);
});
