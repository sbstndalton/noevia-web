'use strict';
// #1490: the Chat / Code switch in the drawer had an English accessible name ("Workspace mode") in
// every locale. The group label now comes from the catalogue, and each locale has its own wording.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalogue, LOCALES } = require('./i18n-catalogue.cjs');

test('#1490 the switch group is labelled through the catalogue, not a literal English string', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/ModeSwitch.tsx'), 'utf8');
  assert.doesNotMatch(src, /aria-label="Workspace mode"/);
  assert.match(src, /aria-label=\{t\('sidebar\.workspaceMode'\)\}/);
  assert.match(src, /import \{ useT \} from '\.\.\/i18n';/);
});

test('#1490 every locale words the switch name, differently from English outside en-GB', () => {
  const english = catalogue('en-GB')['sidebar.workspaceMode'];
  assert.equal(english, 'Workspace mode');
  for (const locale of LOCALES) {
    const value = catalogue(locale)['sidebar.workspaceMode'];
    assert.ok(value && value.trim(), `${locale} has sidebar.workspaceMode`);
    assert.doesNotMatch(value, /\{[a-z]+\}/, `${locale} has no placeholder`);
    if (locale !== 'en-GB') assert.notEqual(value, english, `${locale} is translated`);
  }
  assert.equal(catalogue('sv-SE')['sidebar.workspaceMode'], 'Arbetsläge');
  assert.equal(catalogue('nb-NO')['sidebar.workspaceMode'], 'Arbeidsmodus');
});
