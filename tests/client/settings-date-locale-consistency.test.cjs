'use strict';
// #405: `t.locale` (the interface-text locale — "system" resolves it via a coarse browser-
// language match, e.g. bare "en" becomes "en-GB") and `appLocale()` (the formatter the rest of
// the app uses for dates and numbers — "system" there is `undefined`, the real Intl default)
// answered "what locale should this date use" differently, so the same account could see
// "10/09/2026" on one Settings page and "9/26/2026" a click away. Every Settings date now goes
// through `appLocale()`; this pins that and guards against a new call site reintroducing
// `t.locale` for date/number formatting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');

function allTsx(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allTsx(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// The exact shape every broken call site had: a date/number Intl-backed formatter fed `t.locale`
// directly. (`t.locale` remains legitimate for non-formatting interface-text uses elsewhere.)
const BANNED = /\.(toLocaleDateString|toLocaleString|toLocaleTimeString)\(\s*t\.locale\s*\)|Intl\.(DateTimeFormat|NumberFormat)\(\s*t\.locale\b/;

test('#405: no component formats a date or number with t.locale — appLocale() is the one locale every date in the app uses', () => {
  const offenders = [];
  for (const file of allTsx(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    if (BANNED.test(text)) offenders.push(path.relative(SRC, file));
  }
  assert.deepEqual(offenders, [], `these files format a date/number with t.locale instead of appLocale(): ${offenders.join(', ')}`);
});

// One entry per call site the live tester's own audit found (#405's report) plus the same-pattern
// siblings a repo-wide grep turned up in the same Settings pages (Models & routing, Usage) —
// pinned individually so a future partial revert of any one of them is caught by name.
const FIXED_SITES = [
  ['components/DiaryConnectors.tsx', /toLocaleDateString\(appLocale\(\)\)/],
  ['components/NativeCalibration.tsx', /toLocaleString\(appLocale\(\)\)/],
  ['components/UsageView.tsx', /shortName\(appLocale\(\), date, 'month'\)/],
  ['components/UsageView.tsx', /shortName\(appLocale\(\), new Date\(2024, 0, d\), 'weekday'\)/],
  ['components/UsageView.tsx', /hourLabel\(data\.peakHour\.hour, appLocale\(\)\)/],
  ['components/models/OverviewTab.tsx', /toLocaleDateString\(appLocale\(\)\)/],
  ['components/models/ConfigureTab.tsx', /toLocaleString\(appLocale\(\)\)/],
  ['components/models/EvidenceList.tsx', /toLocaleDateString\(appLocale\(\)\)/g],
  ['components/models/AutoTune.tsx', /toLocaleString\(appLocale\(\)\)/],
  ['components/models/BenchmarksTab.tsx', /toLocaleString\(appLocale\(\)\)/],
  ['components/models/GuidedOptimize.tsx', /toLocaleDateString\(appLocale\(\)\)/],
];

test('#405: every previously-inconsistent date call site now uses appLocale(), and imports it', () => {
  for (const [rel, pattern] of FIXED_SITES) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    assert.match(text, pattern, `${rel} no longer matches ${pattern}`);
    assert.match(text, /import \{ appLocale \} from '(\.\.\/)+user-preferences';/, `${rel} does not import appLocale`);
  }
  // EvidenceList.tsx has two independent call sites (row date and external-source retrieved date).
  const evidence = fs.readFileSync(path.join(SRC, 'components/models/EvidenceList.tsx'), 'utf8');
  assert.equal((evidence.match(/toLocaleDateString\(appLocale\(\)\)/g) || []).length, 2, 'EvidenceList has two date call sites, both fixed');
});
