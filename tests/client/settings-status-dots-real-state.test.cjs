'use strict';
// #404: the AI providers and Security and login status dots were `<span className="model-dot" />`
// unconditionally — never `down`, never absent — so they could not have shown anything but green
// even once real state (an unreachable provider, a stale session) applied. SecurityCard and
// ProvidersCard fetch their data in an effect (`useState([])` + `useEffect`), so — unlike
// SettingsView's 'status' section, which takes `health` as a plain prop and is rendered for real
// in tests/client/settings-view-retrieval.test.cjs — a static SSR render never reaches the populated
// list (see that file's own comment on the same distinction). This pins the fix by reading the
// source, the technique tests/client/account-menu-a11y.test.cjs and tests/client/edit-project-modal-focus.test.cjs
// already use for markup that only exists once client-side state has data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../src/components/SettingsView.tsx'), 'utf8');

test('#404: a passkey row has no status dot at all — a registered credential has no online/offline state to fake', () => {
  const passkeyRow = src.match(/\{passkeys\.map\(k => <div className="model-row" key=\{k\.id\}>[\s\S]*?<\/div>\)\}/);
  assert.ok(passkeyRow, 'expected to find the passkeys.map row');
  assert.doesNotMatch(passkeyRow[0], /model-dot/, 'a passkey row must not render a status dot');
});

test('#404: a session row\'s dot reflects whether it is the request\'s own session ("current"), not a hard-coded class', () => {
  assert.doesNotMatch(src, /<span className="model-dot" \/>\s*\n\s*<div className="model-name-group">\s*\n\s*<span className="model-name">\{sessionLabel/, 'the session dot must not be unconditional');
  assert.match(src, /<span className=\{`model-dot\$\{s\.current \? '' : ' down'\}`\} \/>/, 'the session dot must key off s.current');
  // The colour alone is not the whole story: the visible text spells out "this device" too.
  assert.match(src, /\{s\.current \? ` · \$\{t\('security\.thisDevice'\)\}` : ''\}/);
});

test('#404: the AI providers dot exists only for the default (actually health-checked) provider, and reflects health.inferenceUp', () => {
  assert.doesNotMatch(src, /<div key=\{p\.id\} className="model-row">\s*\n\s*<span className="model-dot" \/>/, 'a provider row must not render an unconditional dot');
  assert.match(src, /\{p\.isDefault && <span className=\{`model-dot\$\{health\.inferenceUp \? '' : ' down'\}`\} \/>\}/);
  // ProvidersCard must actually receive live health data to have anything real to show.
  assert.match(src, /function ProvidersCard\(\{ health \}: \{ health: HealthState \}\): JSX\.Element/);
  assert.match(src, /\{section === 'providers' && <ProvidersCard health=\{health\} \/>\}/);
});
