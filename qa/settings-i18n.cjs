// Translated Settings screens and the lazily loaded Settings catalogue segment (#285, #286), against
// synthetic APIs only. Serves the built app from ../dist.
//   PLAYWRIGHT_MODULE=… QA_SCREENSHOTS=/tmp/i18n-b-shots node qa/settings-i18n.cjs
// 1. de-DE and fr-FR account locale: Models, Connectors, Data, Memory, Usage, Security, Users and
//    Providers at 375 and 1440, each checked for horizontal overflow and clipped text, screenshotted.
// 2. The German Settings segment is not requested until Settings code loads, and switching the
//    locale from English to German in Settings turns the Security page German.
// 3. With the German Settings segment chunk failing, the shell stays German, Settings pages fall
//    back to English key by key, and the failure is logged once.
// 4. (#293) de-DE and fr-FR: Diary & storage and Service status, and the model manager page (its
//    model list, one model's detail and the routing panel) at 375 and 1440, same overflow and
//    clipping checks; the model manager's German strings arrive only with its own chunk.
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
// Section label, a string that proves the screen rendered translated.
const EXTRA = {
  'de-DE': { diary: ['Tagebuch & Speicher', 'Optionale Apps', 'Connector hinzufügen'], status: ['Dienststatus', 'Verbundene Dienste', '12 Tools gefunden'],
    models: 'Modelle & Routing', open: 'Modellmanager öffnen', mmTitle: 'Modelle & Routing', tune: 'Tunen', guided: 'Dieses Modell optimieren', back: 'Alle Modelle',
    routingTab: 'Routing', routing: 'Standard-Modellmodus', yours: 'Deine Modelle', listText: 'Nach Updates suchen' },
  'fr-FR': { diary: ['Journal et stockage', 'Apps facultatives', 'Ajouter un connecteur'], status: ['État des services', 'Services connectés', '12 outils découverts'],
    models: 'Modèles et routage', open: 'Ouvrir le gestionnaire de modèles', mmTitle: 'Modèles et routage', tune: 'Régler', guided: 'Optimiser ce modèle', back: 'Tous les modèles',
    routingTab: 'Routage', routing: 'Mode de modèle par défaut', yours: 'Vos modèles', listText: 'Rechercher des mises à jour' },
};
// Synthetic model manager and Settings APIs for section 4 (no real engine, diary or MCP server).
const INSTALLED = [{ name: 'Synthetic-Qwen-9B-Q4_K_M', labels: ['vision'], loaded: true, sizeGB: 5.6, maxContext: 262144, source: 'preset', canDelete: false, status: 'loaded' },
  { name: 'Synthetic-Gemma-E2B', labels: [], loaded: false, sizeGB: 3, maxContext: 131072, source: 'preset', canDelete: false, status: 'unloaded' }];
const SCHEMA = [{ tier: 'Common', open: true, fields: [{ key: 'model', label: 'Model file', kind: 'text', choices: [], placeholder: '', help: 'Model path' }, { key: 'ctx-size', label: 'Context size', kind: 'int', choices: [], placeholder: '8192', help: 'Tokens' }] }];
function extraApi(route, p, req) {
  const json = (body, status = 200) => route.fulfill({ status, json: body });
  const now = Date.now();
  if (p === '/api/health') return json({ inferenceUp: true, diaryUp: true, ragAvailable: false });
  if (p === '/api/toolboxes') return json({ toolboxes: [], mcp: { configured: true, servers: [{ id: 'synthetic-docs', auth: 'bearer', discovered: 12, missingCurated: 1, checkedAt: now }, { id: 'core', auth: 'internal', discovered: 8, missingCurated: 0, checkedAt: now }] } });
  if (p === '/api/profile/diary-connectors') return json({ connectors: [{ id: 'c1', name: 'Synthetisches Telefon', createdAt: now }] });
  if (p === '/api/profile/sharing') return json({ available: false, reason: 'Synthetic.', scope: 'off', cleartext: false, url: '', eligible: false });
  if (p === '/api/integrations/storage') return json({ kind: 'local', baseUrl: '', username: '', corpusRoot: '' });
  if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true, autotune: true });
  if (p === '/api/models/installed') return json(INSTALLED);
  if (p === '/api/routing-default') return json({ routing: 'auto' });
  if (p === '/api/sampling-settings') return json({ enabled: true, admin: true });
  if (p === '/api/models/estimate') return json({ model: 'Synthetic-Qwen-9B-Q4_K_M', budgetGib: 14, chat: true, sizeable: true, arch: 'qwen35', nativeCtx: 262144, modelGib: 5.6, pinnedGib: 0.9, reserveGib: 0.5, safety: 1.05, moe: false,
    rows: [{ ctx: 8192, kvQ8Gib: 0.14 }, { ctx: 32768, kvQ8Gib: 0.53 }, { ctx: 131072, kvQ8Gib: 2.1 }], current: { ctx: 32768, kv: 'q8_0' } });
  if (p === '/api/models/hardware') return json({ systemGB: 32, gpus: [{ name: 'Synthetic iGPU', capacityGB: 2, sharedGB: 12 }] });
  if (p === '/api/models/autotune') return json({ job: null, history: [{ at: now, kv: 'q8_0', context: 32768, specLabel: 'MTP', generation: 33.4 }] });
  if (p === '/api/models/calibration') return json({ job: null, history: [{ at: now, appliedCtx: 32768, verifiedCtx: 32768, promptBudgetSeconds: 120 }] });
  if (p === '/api/models/evidence') return json({ tracked: true, categories: [{ category: 'context_capacity', state: 'verified', value: { ctx: 32768 }, at: now, suite: null, limitations: [] }, { category: 'throughput', state: 'reported', value: { rate: 13.7 }, at: now, suite: null, limitations: [] }], external: null });
  if (p.startsWith('/api/models/')) return json([]);
  if (!p.startsWith('/api/model-manager/')) return undefined;
  const r = p.slice('/api/model-manager/'.length);
  if (r === 'models') return json({ models: [{ key: 'q/Synthetic-Qwen-9B-Q4_K_M.gguf', name: 'Synthetic-Qwen-9B-Q4_K_M.gguf', subdir: 'q', bytes: 5.6e9, size: '5.6 GB', modified: '2026-09-01', sharded: false, parts: 1, projector: { name: 'mmproj.gguf', bytes: 9e8 }, sections: ['Synthetic-Qwen-9B-Q4_K_M'], modelId: 'Synthetic-Qwen-9B-Q4_K_M', file: 'q/Synthetic-Qwen-9B-Q4_K_M.gguf', shape: { arch: 'qwen35', moe: false, experts: 0, active: 0, label: 'dense' }, loadedOn: ['synthetic-llama'], fit: [], badges: [{ category: 'coding', rating: 4, note: '' }] }], unregistered: [] });
  if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/synthetic/models', exists: true, disk: { freeH: '139.7 GB', totalH: '465.7 GB', usedPct: 70 } } });
  if (r === 'models/updates') return json({ status: { 'Synthetic-Qwen-9B-Q4_K_M.gguf': { status: 'stale', remote: '2026-09-10', delta_days: 9 } } });
  if (r === 'sections' && req.method() === 'GET') return json({ revision: 'r1', schema: SCHEMA, sections: [{ name: 'Synthetic-Qwen-9B-Q4_K_M', items: [], hasFile: true, file: 'q/Synthetic-Qwen-9B-Q4_K_M.gguf', cli: 'llama-server -m q' }], unregistered: [], backups: [['models.ini.bak-1', now / 1000, 100]], raw: '[Synthetic-Qwen-9B-Q4_K_M]\n' });
  if (r.endsWith('/draft-heads')) return json({ local: '', builtinLayers: 1, available: true, remote: [], mtpBuild: null, repo: null });
  if (r.startsWith('sections/')) return json({ name: 'Synthetic-Qwen-9B-Q4_K_M', exists: true, values: { model: '/models/q/Synthetic-Qwen-9B-Q4_K_M.gguf', 'ctx-size': '32768' }, extras: '', hints: [], revision: 'r1', schema: SCHEMA });
  return json({});
}

const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const totals = (input, output, replies) => ({ input, output, replies });
const USAGE = { days: [{ day: day(2), ...totals(0, 0, 0) }, { day: day(1), ...totals(4000, 1200, 3) }, { day: day(0), ...totals(9000, 3000, 5) }],
  allTime: totals(13000, 4200, 8), last7: totals(13000, 4200, 8), last30: totals(13000, 4200, 8), activeDays: 2, currentStreak: 2, longestStreak: 2,
  models: [{ name: 'synthetic-30b', ...totals(10000, 3200, 6) }], tools: [{ name: 'read_project_file', calls: 9 }], hours: Array.from({ length: 24 }, (_, h) => (h === 14 ? 6 : 0)),
  peakHour: { hour: 14, replies: 6 }, retentionDays: 365, timeZone: 'Europe/Oslo' };

async function openPage(browser, width, prefs, extra) {
  const touch = width < 800;
  const page = await browser.newPage(withLocale({ viewport: { width, height: touch ? 812 : 900 }, hasTouch: touch, isMobile: touch }));
  const admin = { id: 'synthetic-admin', username: 'synthadmin', displayName: 'Synthetische Administratorin', role: 'admin', diaryEnabled: !!extra, onboarded: true };
  const member = { id: 'synthetic-member', username: 'synthmember', displayName: 'Synthetisches Mitglied', role: 'member', disabled: true };
  const profile = { user: admin, passkeys: [{ id: 'k1', name: 'Synthetischer Schlüssel', backedUp: true, deviceType: 'multiDevice' }],
    sessions: [{ id: 's1', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605 Version/17 Safari/605', ip: '192.0.2.10', lastSeenAt: Date.now() }] };
  await page.addInitScript(() => localStorage.setItem('cowork-theme', 'light'));
  await page.route('**/api/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname;
    if (extra) { const handled = extra(route, p, req); if (handled) return handled; }
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

async function checkLayout(page, name, root = '.settings-detail-scroll') {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const state = await page.evaluate((root) => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const scrolls = (e) => /auto|scroll/.test(getComputedStyle(e).overflowX);
    const extra = root === '.settings-detail-scroll' ? '' : ', h4, summary, legend, th, .mm-pill, .mm-note, .model-card-state, .model-card-tag, .popup-tab, .modal-btn';
    const clipped = [...document.querySelectorAll(`${root} :is(button, label, h1, h2, h3, select, .set-row-label, .set-row-desc, .route-note, .model-name, .model-quant, .model-role, .usage-stat-label, .usage-stat-hint, .badge, .row-label, .row-desc, dt, dd${extra})`)]
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
  }, root);
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
    // 4. Diary & storage, Service status and the model manager page (#293), both languages, phone and desktop.
    for (const locale of ['de-DE', 'fr-FR']) for (const width of [375, 1440]) {
      const l = L[locale], x = EXTRA[locale];
      const page = await openPage(browser, width, { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale }, extraApi);
      page.on('pageerror', (e) => errors.push(`${locale} ${width} #293: ${e.message}`));
      let mmCode = false; const early = [];
      page.on('request', (r) => { if (/ModelManagerPage/.test(r.url())) mmCode = true; });
      page.on('response', async (r) => { if (/\/assets\/(de-DE|fr-FR)-[^/]+\.js$/.test(r.url()) && (await r.text()).includes('mm.fit.rec.use') && !mmCode) early.push(r.url()); });
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder(l.composer).waitFor();
      const settings = await openSettings(page, l.settings);
      for (const [id, [label, heading, text]] of [['diary', x.diary], ['status', x.status]]) {
        await openSection(page, settings, l, label);
        await settings.locator('.settings-detail-scroll').getByText(heading, { exact: false }).first().waitFor();
        await settings.locator('.settings-detail-scroll').getByText(text, { exact: false }).first().waitFor();
        await checkLayout(page, `${locale} ${width} ${id}`);
        await page.screenshot({ path: path.join(out, `${locale}-${width}-${id}.png`), fullPage: true });
      }
      await openSection(page, settings, l, x.models);
      await settings.getByRole('button', { name: x.open }).click();
      const mm = page.locator('.model-manager-page');
      await mm.getByRole('heading', { name: x.mmTitle, level: 1 }).waitFor();
      await mm.getByRole('tab', { name: x.yours, selected: true }).waitFor();
      await mm.getByRole('article', { name: INSTALLED[0].name }).waitFor();
      await mm.getByText(x.listText).first().waitFor();
      await checkLayout(page, `${locale} ${width} models-list`, '.model-manager-page');
      await page.screenshot({ path: path.join(out, `${locale}-${width}-models-list.png`), fullPage: true });
      await mm.getByRole('article', { name: INSTALLED[0].name }).getByRole('button', { name: x.tune, exact: true }).click();
      await mm.getByRole('heading', { name: x.guided, level: 3 }).waitFor();
      await mm.locator('.mm-fit-verdict').waitFor();
      await checkLayout(page, `${locale} ${width} models-detail`, '.model-manager-page');
      await page.screenshot({ path: path.join(out, `${locale}-${width}-models-detail.png`), fullPage: true });
      await mm.getByRole('button', { name: x.back }).click();
      await mm.getByRole('tab', { name: x.routingTab, exact: true }).click();
      await mm.getByRole('heading', { name: x.routing, level: 3 }).waitFor();
      await checkLayout(page, `${locale} ${width} models-routing`, '.model-manager-page');
      await page.screenshot({ path: path.join(out, `${locale}-${width}-models-routing.png`), fullPage: true });
      assert.deepEqual(early, [], 'model manager strings requested before its chunk');
      await page.close();
    }

    assert.deepEqual(errors, []);
    console.log(`PASS settings i18n (#293 too: Diary & storage, Service status, model manager list/detail/routing in de-DE and fr-FR at 375/1440): 8 Settings screens in de-DE and fr-FR at 375/1440 without overflow or clipping; German Settings segment loads once, only with Settings, after an English→German switch; a failed segment leaves Settings English with one warning. Screenshots in ${out}`);
  } finally { await browser.close(); await fixture.close?.(); }
})().catch((e) => { console.error(e); process.exit(1); });
