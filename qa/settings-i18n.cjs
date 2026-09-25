// Translated Settings screens and the lazily loaded Settings catalogue segment (#285, #286), against
// synthetic APIs only. Serves the built app from ../dist.
//   PLAYWRIGHT_MODULE=… QA_SCREENSHOTS=/tmp/i18n-b-shots node qa/settings-i18n.cjs
// 1. de-DE and fr-FR account locale: Models, Connectors, Data, Memory, Usage, Security, Users and
//    Providers at 375 and 1440, each checked for horizontal overflow and clipped text, screenshotted.
// 2. The German Settings segment is not requested until Settings code loads, and switching the
//    locale from English to German in Settings turns the Security page German.
// 3. With the German Settings segment chunk failing, the shell stays German, Settings pages fall
//    back to English key by key, and the failure is logged once.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const out = process.env.QA_SCREENSHOTS || '/tmp/i18n-b-shots';
const PORT = 31479;
const L = {
  'de-DE': { settings: 'Einstellungen', all: 'Alle Einstellungen', composer: 'Nachricht an noevia…',
    screens: [['models', 'Modelle & Routing', 'Modellmanager öffnen'], ['connectors', 'Verbundene Apps', 'Dateien suchen, lesen und speichern.'], ['data', 'Deine Daten & Datenschutz', 'Unterhaltungen exportieren'],
      ['memory', 'Gedächtnis', 'Projektgedächtnis verwenden'], ['usage', 'Nutzung', 'Stärkste Stunde'], ['security', 'Sicherheit & Anmeldung', 'Passkey hinzufügen'], ['users', 'Benutzer', 'Einladungslink kopieren'], ['providers', 'KI-Anbieter', 'Anbieter verbinden']] },
  'fr-FR': { settings: 'Réglages', all: 'Tous les réglages', composer: 'Écrire à noevia…',
    screens: [['models', 'Modèles et routage', 'Ouvrir le gestionnaire de modèles'], ['connectors', 'Apps connectées', 'Rechercher, lire et enregistrer des fichiers.'], ['data', 'Vos données et confidentialité', 'Exporter les conversations'],
      ['memory', 'Mémoire', 'Utiliser la mémoire des projets'], ['usage', 'Utilisation', 'Heure de pointe'], ['security', 'Sécurité et connexion', 'Ajouter une clé d’accès'], ['users', 'Utilisateurs', 'Copier le lien d’invitation'], ['providers', 'Fournisseurs d’IA', 'Connecter un fournisseur']] },
};
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const totals = (input, output, replies) => ({ input, output, replies });
const USAGE = { days: [{ day: day(2), ...totals(0, 0, 0) }, { day: day(1), ...totals(4000, 1200, 3) }, { day: day(0), ...totals(9000, 3000, 5) }],
  allTime: totals(13000, 4200, 8), last7: totals(13000, 4200, 8), last30: totals(13000, 4200, 8), activeDays: 2, currentStreak: 2, longestStreak: 2,
  models: [{ name: 'synthetic-30b', ...totals(10000, 3200, 6) }], tools: [{ name: 'read_project_file', calls: 9 }], hours: Array.from({ length: 24 }, (_, h) => (h === 14 ? 6 : 0)),
  peakHour: { hour: 14, replies: 6 }, retentionDays: 365, timeZone: 'Europe/Oslo' };

async function openPage(browser, width, prefs) {
  const touch = width < 800;
  const page = await browser.newPage(withLocale({ viewport: { width, height: touch ? 812 : 900 }, hasTouch: touch, isMobile: touch }));
  const admin = { id: 'synthetic-admin', username: 'synthadmin', displayName: 'Synthetische Administratorin', role: 'admin', diaryEnabled: false, onboarded: true };
  const member = { id: 'synthetic-member', username: 'synthmember', displayName: 'Synthetisches Mitglied', role: 'member', disabled: true };
  const profile = { user: admin, passkeys: [{ id: 'k1', name: 'Synthetischer Schlüssel', backedUp: true, deviceType: 'multiDevice' }],
    sessions: [{ id: 's1', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605 Version/17 Safari/605', ip: '192.0.2.10', lastSeenAt: Date.now() }] };
  await page.addInitScript(() => localStorage.setItem('cowork-theme', 'light'));
  await page.route('**/api/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (p === '/api/profile' || p === '/api/auth/session') return route.fulfill({ json: profile });
    if (p === '/api/profile/appearance') return route.fulfill({ json: { theme: 'light', light: 'iris', dark: 'iris' } });
    if (p === '/api/profile/app-passwords') return route.fulfill({ json: { appPasswords: [{ id: 'a1', name: 'Synthetischer Laptop', scope: 'lan', createdAt: Date.now(), lastUsedAt: null }] } });
    if (p === '/api/account/preferences') {
      if (req.method() === 'PUT') Object.assign(prefs, JSON.parse(req.postData() || '{}'));
      return route.fulfill({ json: prefs });
    }
    if (p === '/api/admin/users') return route.fulfill({ json: { users: [admin, member] } });
    if (p === '/api/usage') return route.fulfill({ json: USAGE });
    if (p === '/api/account/retention') return route.fulfill({ json: { days: 0, periods: [30, 90, 365], preview: { 30: 2, 90: 1, 365: 0 } } });
    if (p === '/api/account/memory') return route.fulfill({ json: { memories: ['Synthetische Zeile über Gartenarbeit'], useProjectMemories: true, updatedAt: 1, maxItems: 50, maxItemChars: 300 } });
    if (p === '/api/auto-roles') return route.fulfill({ json: { configured: true, roles: { fast: 'synthetic-4b', smart: 'synthetic-30b', vision: null } } });
    if (p === '/api/providers') return route.fulfill({ json: { providers: [{ id: 'local', label: 'Synthetic local', baseUrl: 'http://127.0.0.1:9/v1', isDefault: true }, { id: 'or', label: 'Synthetic router', baseUrl: 'https://example.invalid/v1', isDefault: false, apiKeyMasked: '…abcd' }] } });
    return route.continue();
  });
  return page;
}

async function openSettings(page, title) {
  await page.getByTitle(title, { exact: true }).first().click();
  const settings = page.getByRole('region', { name: title, exact: true });
  await settings.waitFor();
  return settings;
}
async function openSection(page, settings, l, label) {
  const back = settings.getByRole('button', { name: l.all, exact: true });
  if (await back.isVisible()) await back.click();
  await settings.locator('.settings-navigation').getByRole('button', { name: label, exact: true }).click();
}

async function checkLayout(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const scrolls = (e) => /auto|scroll/.test(getComputedStyle(e).overflowX);
    const clipped = [...document.querySelectorAll('.settings-detail-scroll :is(button, label, h1, h2, h3, select, .set-row-label, .set-row-desc, .route-note, .model-name, .model-quant, .model-role, .usage-stat-label, .usage-stat-hint, .badge, .row-label, .row-desc, dt, dd)')]
      .filter((e) => e.offsetParent && e.getClientRects().length && !e.closest('[hidden], .usage-heatmap-scroll'))
      .filter((e) => {
        if (e.scrollWidth > e.clientWidth + 1 && !scrolls(e) && getComputedStyle(e).textOverflow !== 'ellipsis') return true;
        let clip = e.parentElement;
        while (clip && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement;
        if (clip && (clip.classList.contains('glass-seg') || scrolls(clip))) return false;
        const r = e.getBoundingClientRect(), p = clip ? clip.getBoundingClientRect() : { left: 0, right: window.innerWidth };
        return r.right > Math.min(p.right, window.innerWidth) + 1 || r.left < Math.max(p.left, 0) - 1;
      })
      .map((e) => `${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)} [${e.tagName}.${e.className}]`);
    return { overflow, clipped };
  });
  assert.equal(state.overflow, false, `${name}: horizontal overflow`);
  assert.deepEqual(state.clipped, [], `${name}: clipped ${state.clipped.join(' | ')}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    // 1. Every translated screen, both languages, phone and desktop.
    for (const locale of ['de-DE', 'fr-FR']) for (const width of [375, 1440]) {
      const l = L[locale];
      const page = await openPage(browser, width, { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale });
      page.on('pageerror', (e) => errors.push(`${locale} ${width}: ${e.message}`));
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder(l.composer).waitFor();
      const settings = await openSettings(page, l.settings);
      for (const [id, label, expected] of l.screens) {
        await openSection(page, settings, l, label);
        await settings.locator('.settings-detail-scroll').getByText(expected, { exact: false }).first().waitFor();
        if (id === 'usage') assert.equal((await settings.locator('.usage-stat').nth(4).locator('.usage-stat-value').innerText()).trim(), locale === 'de-DE' ? '14 Uhr' : '14 h');
        await checkLayout(page, `${locale} ${width} ${id}`);
        await page.screenshot({ path: path.join(out, `${locale}-${width}-${id}.png`), fullPage: true });
      }
      await page.close();
    }

    // 2. English first; the German Settings segment arrives only with Settings, after the switch.
    {
      const segmentRequests = [];
      const prefs = { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'en-GB' };
      const page = await openPage(browser, 1440, prefs);
      page.on('pageerror', (e) => errors.push(`switch: ${e.message}`));
      page.on('response', async (r) => { if (/\/assets\/de-DE-[^/]+\.js$/.test(r.url()) && (await r.text()).includes('Passkey hinzufügen')) segmentRequests.push(r.url()); });
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      let settings = await openSettings(page, 'Settings');
      await openSection(page, settings, { all: 'All settings' }, 'Appearance & language');
      assert.equal(segmentRequests.length, 0, 'no German strings before German is chosen');
      await settings.getByLabel('Interface language, dates and numbers').selectOption('de-DE');
      settings = page.getByRole('region', { name: 'Einstellungen', exact: true });
      await openSection(page, settings, { all: 'Alle Einstellungen' }, 'Sicherheit & Anmeldung');
      await settings.getByRole('button', { name: 'Passkey hinzufügen' }).waitFor();
      assert.equal(segmentRequests.length, 1, 'the German Settings segment loads once');
      assert.equal(prefs.locale, 'de-DE');
      await page.close();
    }
    // A fresh German page never asks for the German Settings strings before Settings code has loaded.
    {
      const early = [];
      const page = await openPage(browser, 1440, { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'de-DE' });
      page.on('pageerror', (e) => errors.push(`fresh: ${e.message}`));
      let settingsCode = false;
      page.on('request', (r) => { if (/SettingsShell|PluginsView|ConnectorsSettings/.test(r.url())) settingsCode = true; });
      page.on('response', async (r) => { if (/\/assets\/de-DE-[^/]+\.js$/.test(r.url()) && (await r.text()).includes('Passkey hinzufügen') && !settingsCode) early.push(r.url()); });
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder('Nachricht an noevia…').waitFor();
      const settings = await openSettings(page, 'Einstellungen');
      await openSection(page, settings, { all: 'Alle Einstellungen' }, 'Nutzung');
      await settings.getByText('Stärkste Stunde', { exact: true }).waitFor();
      assert.deepEqual(early, [], 'German Settings strings requested before any Settings code');
      await page.close();
    }

    // 3. The German Settings segment chunk fails: English Settings strings, German shell, one warning.
    {
      const warnings = [];
      const page = await openPage(browser, 1440, { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'de-DE' });
      page.on('pageerror', (e) => errors.push(`fallback: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('could not be loaded')) warnings.push(m.text()); });
      await page.route(/\/assets\/de-DE-[^/]+\.js$/, async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        if (body.includes('Passkey hinzufügen')) return route.fulfill({ status: 404, body: 'gone' });
        return route.fulfill({ response, body });
      });
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder('Nachricht an noevia…').waitFor();
      const settings = await openSettings(page, 'Einstellungen');
      await openSection(page, settings, { all: 'All settings' }, 'Security and login');
      await settings.getByRole('button', { name: 'Add passkey' }).waitFor();
      await settings.getByRole('heading', { name: 'Security and login', level: 1 }).waitFor();
      assert.ok(await page.getByPlaceholder('Nachricht an noevia…').count(), 'the shell stays German');
      assert.equal(warnings.length, 1, `one warning, got ${warnings.length}`);
      await openSection(page, settings, { all: 'All settings' }, 'Usage');
      await settings.getByText('Peak hour', { exact: true }).waitFor();
      assert.equal(warnings.length, 1, 'no retry after the failure');
      await page.screenshot({ path: path.join(out, 'de-DE-1440-fallback-security.png') });
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS settings i18n: 8 Settings screens in de-DE and fr-FR at 375/1440 without overflow or clipping; German Settings segment loads once, only with Settings, after an English→German switch; a failed segment leaves Settings English with one warning. Screenshots in ${out}`);
  } finally { await browser.close(); await fixture.close?.(); }
})().catch((e) => { console.error(e); process.exit(1); });
