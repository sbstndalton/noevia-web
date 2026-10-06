'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, extra = {}, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: m => deps[m] ?? require(m), ...extra });
  return exports;
}
const calendar = load('logo-calendar.ts');
const hemi = load('hemisphere.ts');
const favicon = load('favicon.ts', {}, { './logo-calendar': calendar });
const iconSvg = fs.readFileSync(path.join(__dirname, '../../public/icon.svg'), 'utf8');
// All data is synthetic. No real settings, network or inference.

test('seasons per month in both hemispheres (meteorological, local month)', () => {
  const north = ['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter'];
  const south = ['summer','summer','autumn','autumn','autumn','winter','winter','winter','spring','spring','spring','summer'];
  for (let month = 0; month < 12; month++) {
    for (const day of [1, 28]) {
      const date = new Date(2026, month, day);
      assert.equal(calendar.calendarLogo('north', date), north[month], `north ${month}`);
      assert.equal(calendar.calendarLogo('south', date), south[month], `south ${month}`);
    }
  }
  assert.equal(calendar.calendarLogo('south', new Date('invalid')), 'default');
});
test('the monthly occasion palettes are gone from the palette list', () => {
  assert.deepEqual(Array.from(calendar.LOGO_PALETTES), ['default', 'spring', 'summer', 'autumn', 'winter']);
  let current = 'default'; const seen = [];
  for (let i = 0; i < calendar.LOGO_PALETTES.length; i++) { current = calendar.nextLogoPalette(current); seen.push(current); }
  assert.deepEqual(Array.from(seen), ['spring', 'summer', 'autumn', 'winter', 'default']);
});
test('time zone to hemisphere, including edge zones', () => {
  const south = ['Australia/Sydney', 'Australia/Perth', 'Australia/Darwin', 'Australia/Lord_Howe', 'Pacific/Auckland', 'Pacific/Chatham',
    'Pacific/Fiji', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Argentina/Ushuaia', 'America/Santiago', 'America/Lima',
    'America/Montevideo', 'America/Asuncion', 'Africa/Johannesburg', 'Africa/Windhoek', 'Africa/Maputo', 'Indian/Mauritius',
    'Atlantic/Stanley', 'Antarctica/McMurdo', 'Antarctica/Troll', 'Brazil/East', 'Chile/Continental'];
  for (const zone of south) assert.equal(hemi.hemisphereForTimeZone(zone), 'south', zone);
  const north = ['Europe/Oslo', 'Europe/London', 'America/New_York', 'America/Mexico_City', 'Asia/Tokyo', 'Asia/Kolkata', 'Africa/Cairo', 'Africa/Lagos',
    'Pacific/Honolulu', 'UTC', 'Etc/UTC', 'America/Bogota'];
  for (const zone of north) assert.equal(hemi.hemisphereForTimeZone(zone), 'north', zone);
});
test('equatorial and unknown zones default to north', () => {
  // Documented choice: near the equator either answer is acceptable, so Jakarta, Nairobi, Manaus stay north.
  for (const zone of ['Asia/Jakarta', 'Africa/Nairobi', 'America/Manaus', 'America/Guayaquil', 'Pacific/Galapagos', 'Asia/Singapore']) {
    assert.equal(hemi.hemisphereForTimeZone(zone), 'north', zone);
  }
  for (const bad of [undefined, null, '', '   ', 'Not/AZone', 42, {}]) assert.equal(hemi.hemisphereForTimeZone(bad), 'north');
  assert.equal(hemi.hemisphereForTimeZone(' Australia/Perth '), 'south');
});
test('detectHemisphere reads the browser time zone and never throws', () => {
  const withZone = tz => load('hemisphere.ts', { Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: tz }) }) } }, { './logo-calendar': calendar });
  assert.equal(withZone('Pacific/Auckland').detectHemisphere(), 'south');
  assert.equal(withZone('Europe/Oslo').detectHemisphere(), 'north');
  assert.equal(load('hemisphere.ts', { Intl: { DateTimeFormat: () => { throw new Error('no intl'); } } }).detectHemisphere(), 'north');
});

test('palette table matches the CSS tokens the sidebar logo uses', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../src/styles/logo-calendar.css'), 'utf8');
  const names = Object.keys(calendar.PALETTE_COLOURS);
  assert.deepEqual(names.slice().sort(), Array.from(calendar.LOGO_PALETTES).filter(p => p !== 'default').sort());
  for (const name of names) {
    const block = css.match(new RegExp(`:root\\[data-logo-palette="${name}"\\] \\{([^}]*)\\}`))[1];
    for (const [key, value] of Object.entries(calendar.PALETTE_COLOURS[name])) {
      assert.match(block, new RegExp(`--logo-${key}: ${value};`, 'i'), `${name} ${key}`);
    }
  }
  assert.doesNotMatch(css, /data-logo-palette="(rose|clover|harvest|festive)"/);
});
test('favicon svg is the icon recoloured per season and stays well-formed', () => {
  assert.equal(favicon.faviconSvg(iconSvg, 'default'), iconSvg);
  assert.equal(favicon.faviconHref(iconSvg, 'default'), '/icon.svg');
  const out = {};
  for (const p of ['spring', 'summer', 'autumn', 'winter']) {
    out[p] = favicon.faviconSvg(iconSvg, p);
    assert.ok(out[p].includes(calendar.PALETTE_COLOURS[p].dark), p);
    assert.ok(out[p].includes(calendar.PALETTE_COLOURS[p].twig), p);
    assert.doesNotMatch(out[p], /#2F7D4F|#84593A|#4FA36A|#7CC48A/i, `${p} leaves no default fill`);
    assert.equal(out[p].replace(/#[0-9a-f]{6}/gi, '#'), iconSvg.replace(/#[0-9a-f]{6}/gi, '#'), 'only colours change');
    assert.match(favicon.faviconHref(iconSvg, p), /^data:image\/svg\+xml,/);
  }
  assert.equal(new Set(Object.values(out)).size, 4);
});

function runtime({ month, timeZone, stored = new Map(), fetchOk = true }) {
  const listeners = new Map(), timers = new Map(), fetched = [];
  const link = { href: '/icon.svg', type: 'image/svg+xml' };
  const document = { documentElement: { dataset: {} }, querySelector: s => (s === 'link[rel="icon"]' ? link : null),
    addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k) };
  const state = { month, timeZone };
  const localStorage = { getItem: k => stored.get(k) ?? null, removeItem: k => stored.delete(k) };
  const fakeCalendar = { ...calendar, calendarLogo: (hemisphere) => calendar.calendarLogo(hemisphere, new Date(2026, state.month, 15)) };
  const fakeHemi = load('hemisphere.ts', { Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: state.timeZone }) }) } });
  const fetch = async url => { fetched.push(url); return fetchOk ? { ok: true, text: async () => iconSvg } : { ok: false }; };
  const fav = load('favicon.ts', { document, fetch, encodeURIComponent }, { './logo-calendar': calendar });
  const rt = load('logo-appearance.ts', { document, localStorage, void: undefined, window: { setInterval: fn => { timers.set(1, fn); return 1; } }, clearInterval: k => timers.delete(k) },
    { './logo-calendar': fakeCalendar, './hemisphere': fakeHemi, './favicon': fav });
  return { rt, state, link, listeners, timers, fetched, stored, document };
}
const tick = () => new Promise(r => setImmediate(r));

test('runtime: clears stale keys, follows hemisphere and date, swaps the favicon, cleans up', async () => {
  const stored = new Map([['noevia:logo-calendar', 'monthly'], ['noevia:logo-hemisphere', 'north'], ['noevia:theme-family', 'glass']]);
  const r = runtime({ month: 0, timeZone: 'Australia/Perth', stored });
  const stop = r.rt.startLogoAppearance();
  assert.deepEqual(Array.from(stored.keys()), ['noevia:theme-family']);
  const palette = () => r.document.documentElement.dataset.logoPalette;
  assert.equal(palette(), 'summer');
  await tick(); assert.ok(r.link.href.startsWith('data:image/svg+xml,'));
  const summer = r.link.href;
  r.state.month = 6; r.timers.get(1)(); assert.equal(palette(), 'winter');
  await tick(); assert.notEqual(r.link.href, summer);
  r.timers.get(1)(); await tick(); assert.equal(r.fetched.length, 1, 'template fetched once');
  r.rt.previewLogo('autumn'); assert.equal(palette(), 'autumn');
  r.rt.previewLogo(null); assert.equal(palette(), 'winter');
  r.rt.previewLogo('default'); await tick(); assert.equal(r.link.href, '/icon.svg');
  r.rt.previewLogo(null); assert.equal(palette(), 'winter');
  r.document.documentElement.dataset.logoPalette = 'x';
  r.listeners.get('visibilitychange')(); assert.equal(palette(), 'winter');
  stop(); assert.equal(r.timers.size, 0); assert.equal(r.listeners.size, 0);
});
test('runtime: northern time zone gets northern seasons; unknown zone defaults north', () => {
  const north = runtime({ month: 0, timeZone: 'Europe/Oslo' }); north.rt.startLogoAppearance();
  assert.equal(north.document.documentElement.dataset.logoPalette, 'winter');
  const unknown = runtime({ month: 0, timeZone: undefined }); unknown.rt.startLogoAppearance();
  assert.equal(unknown.document.documentElement.dataset.logoPalette, 'winter');
});
test('runtime: a failed icon fetch keeps the static icon and retries later', async () => {
  const r = runtime({ month: 0, timeZone: 'Europe/Oslo', fetchOk: false });
  r.rt.startLogoAppearance(); await tick();
  assert.equal(r.link.href, '/icon.svg');
  r.timers.get(1)(); await tick(); assert.equal(r.fetched.length, 2, 'retried');
});
test('stale-key cleanup survives unavailable storage', () => {
  const rt = load('logo-appearance.ts', { localStorage: { removeItem: () => { throw new Error('blocked'); } } },
    { './logo-calendar': calendar, './hemisphere': hemi, './favicon': favicon });
  assert.doesNotThrow(() => rt.clearStaleLogoPreferences());
});
