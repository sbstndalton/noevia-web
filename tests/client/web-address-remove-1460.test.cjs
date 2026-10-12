// #1460 (web half): Settings → Web address lists each earlier address with its own Remove control. Removing
// one asks first (the confirm says passkeys made at that address stop working there), then calls the core
// endpoint this side expects (draft b21): POST /api/admin/web-address/remove-earlier with { origin }, answered
// with the same view as GET (current, source, previous, rpId) or { error }. The settings-row fetch happens in
// an effect, so the list itself is checked by source contract (the click path is a browser check, unverified).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('removing an earlier address posts its origin to the core endpoint and takes the returned view', () => {
  const src = read('components/web-address/WebAddressSettings.tsx');
  assert.match(src, /call<Address>\('\/api\/admin\/web-address\/remove-earlier', tRef\.current\('webAddress\.readError'\), \{ origin \}\)/);
  assert.match(src, /if \(!r\.ok\) \{ setError\(r\.body\.error \|\| tRef\.current\('webAddress\.removeError'\)\); return; \}\n      setCurrent\(r\.body\); setRemoving\(null\);/);
});

test('each earlier address has its own named Remove button, and a removal is confirmed before it is sent', () => {
  const src = read('components/web-address/WebAddressSettings.tsx');
  assert.match(src, /\{current\.previous\.map\(origin => <li key=\{origin\}/);
  assert.match(src, /aria-label=\{t\('webAddress\.removeNamed', \{ origin \}\)\} disabled=\{busy \|\| removeBusy\} onClick=\{\(\) => setRemoving\(origin\)\}/);
  // The Remove request runs only from the confirm button, which shows only for the entry being removed.
  assert.match(src, /\{removing === origin\n\s*\? <span className="web-address-remove-confirm"/);
  assert.match(src, /onClick=\{\(\) => void removeEarlier\(origin\)\}/);
  assert.match(src, /t\('webAddress\.removeWarn', \{ origin \}\)/);
});

test('the confirm can be backed out of, and the buttons stay disabled while a removal is in flight', () => {
  const src = read('components/web-address/WebAddressSettings.tsx');
  assert.match(src, /onClick=\{\(\) => setRemoving\(null\)\}>\{t\('webAddress\.removeKeep'\)\}/);
  assert.match(src, /disabled=\{removeBusy\} onClick=\{\(\) => void removeEarlier\(origin\)\}/);
  assert.match(src, /disabled=\{removeBusy\} onClick=\{\(\) => setRemoving\(null\)\}/);
});

test('every settings catalogue carries the six remove strings', () => {
  for (const file of ['en-GB', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'nb-NO', 'nl-NL', 'pt-BR']) {
    const src = read(`i18n/settings/${file}.ts`);
    for (const key of ['webAddress.remove', 'webAddress.removeNamed', 'webAddress.removeWarn', 'webAddress.removeConfirm', 'webAddress.removeKeep', 'webAddress.removeError']) {
      assert.match(src, new RegExp(`'${key.replace(/\./g, '\\.')}'`), `${file} ${key}`);
    }
  }
});

test('the remove buttons are full-size targets in the stylesheet', () => {
  const css = read('styles/noevia.css');
  assert.match(css, /\.web-address-earlier-row \.btn \{ min-height: 44px; \}/);
});
