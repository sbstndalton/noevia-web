'use strict';
// sbstndalton/noevia#2468 (address part): the section a Settings search opens is reported through onSection, as a click does.
// Browser proof: qa/settings-search-address-2468.cjs.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

test('noevia#2468 the search effect calls the same onSection path as open()', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsShell.tsx'), 'utf8');
  assert.match(shell, /const open = \(id: string\) => \{ setSection\(id\); props\.onSection\?\.\(id\); setView\('detail'\); \};/);
  assert.match(shell, /\{ setSection\(ids\[0\]\); props\.onSection\?\.\(ids\[0\]\); \}/);
});
