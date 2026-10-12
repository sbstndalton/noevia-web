// #1560: Customise → Connectors → Nextcloud showed the same DAV address twice (the Destination row and an
// Address card) and showed the path percent-encoded ("%20" where a space belongs). The address now appears
// once, as the Destination, decoded for display; the reserved escapes stay encoded so the place is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = path.join(__dirname, '../../src');
const cache = {};
function load(relPath, resolveDir) {
  const full = path.posix.normalize(path.posix.join(resolveDir, relPath));
  if (cache[full]) return cache[full];
  const exports = {};
  cache[full] = exports;
  const code = ts.transpileModule(fs.readFileSync(path.join(SRC, full + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const here = path.posix.dirname(full);
  vm.runInNewContext(code, {
    exports, Intl, console: { warn() {} }, Promise,
    require: (m) => { if (!/^\.\.?\//.test(m)) throw Error('unexpected import ' + m); return load(m, here); },
  });
  return exports;
}

const { displayAddress } = load('connector-address', '.');

test('a percent-encoded space in the path is shown as a space', () => {
  assert.equal(displayAddress('https://cloud.example.com/remote.php/dav/files/sam/noevia%20folder/Diary%20notes'), 'https://cloud.example.com/remote.php/dav/files/sam/noevia folder/Diary notes');
});

test('reserved escapes (slash, question mark) stay encoded, so the displayed address still names the same place', () => {
  assert.equal(displayAddress('https://cloud.example.com/dav/a%2Fb%3Fc'), 'https://cloud.example.com/dav/a%2Fb%3Fc');
  // %25 is a percent sign to a person, so it reads as one; %2541 is the literal text %41, not a further escape.
  assert.equal(displayAddress('https://cloud.example.com/dav/100%25'), 'https://cloud.example.com/dav/100%');
  assert.equal(displayAddress('https://cloud.example.com/dav/a%2541'), 'https://cloud.example.com/dav/a%41');
});

test('a malformed escape is shown exactly as it arrived, never thrown', () => {
  assert.equal(displayAddress('https://cloud.example.com/dav/bad%E0%A4%A'), 'https://cloud.example.com/dav/bad%E0%A4%A');
});

test('the Nextcloud page shows the address once: no Address card, and the Destination uses the decoded address', () => {
  const src = fs.readFileSync(path.join(SRC, 'components/connectors/ConnectorsSettings.tsx'), 'utf8');
  const page = src.slice(src.indexOf('function NextcloudPage'));
  assert.doesNotMatch(page, /connectors\.nextcloud\.address/, 'the Address card is still rendered');
  assert.doesNotMatch(page, /<span className="row-desc">\{nc\.baseUrl\}<\/span>/, 'the raw address is still printed in a second place');
  assert.match(page, /origin=\{nc\.baseUrl \? displayAddress\(nc\.baseUrl\) : t\('connectors\.nextcloud\.origin'\)\}/, 'the Destination does not show the decoded address');
});
