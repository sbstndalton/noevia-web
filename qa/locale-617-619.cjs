// #617/#618/#619 in German and French (set in page memory only: the account preferences GET is
// answered with de-DE / fr-FR while the browser itself stays en-US, so it is the account language,
// not the browser's, that must decide):
//   #617  the Code landing (project picker, header) and the project Code tab
//   #618  Settings > Web address, Features, Experimental, Backups (feature names and descriptions
//         come from the server registry by id and are translated on the client)
//   #619  the Diary calendar: month heading, day-button names, and a week that starts on Monday
// Synthetic APIs only (the shared fixture server plus routed admin endpoints, the server's real
// feature registry for the ids); no Diary content is read or written. Fails on a build without the
// fixes and passes with them.
//   npm run build && node qa/locale-617-619.cjs   (QA_DIST=<dir> serves another build; QA_SCREENSHOTS=<dir> saves pictures)
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { createFeatures } = require('../server/features.cjs');

const PORT = Number(process.env.QA_PORT || 31617);
const SHOTS = process.env.QA_SCREENSHOTS || '';
const ORIGIN = `http://localhost:${PORT}`;

// What each language must show; every string is from the catalogue, and the English lists are what an untranslated page prints.
const LANGS = {
  'de-DE': {
    name: 'German',
    landing: { badge: /Läuft in einem Projekt/, title: 'Projekt öffnen, um Code auszuführen', open: 'Code öffnen', header: 'Neue Aufgabe', listLabel: 'Projekte mit Code-Zugriff' },
    code: { intro: /Führt ein Coding-Harness in einem eigenen Git-Worktree auf einem eigenen Branch aus/, repository: 'Repository', preparation: 'Prompt-Aufbereitung', direct: 'Direkt', notAvailable: 'nicht verfügbar', prompt: 'Was soll es tun?', legend: 'Was diese Aufgabe darf', read: 'Das Repository lesen', edit: 'Dateien bearbeiten', run: 'Befehle ausführen', install: 'Abhängigkeiten installieren', start: 'Aufgabe starten', tasks: 'Aufgaben' },
    address: { h1: 'Webadresse', current: 'Aktuelle Adresse', earlier: 'Frühere Adressen', change: 'Adresse ändern', fresh: 'Neue Adresse', check: 'Prüfen und speichern' },
    features: { h1: 'Funktionen', previews: 'Vorschau-Bereiche', previewsDesc: /Zeigt die noch nicht gebauten Vorschauen/, backups: 'Backups', diary: 'Tagebuch-Anfügewerkzeug' },
    experimental: { h1: 'Experimentell', title: 'Einrichtung des Entscheidungsdienstes', label: 'Endpunkt des Entscheidungsdienstes', astra: 'Astra-Review (Code-Modus)' },
    backups: { h1: 'Backups', destination: 'Ziel', schedule: 'Zeitplan', scheduleValue: /Täglich um 02:00 \(Serverzeit\)/, retention: 'Aufbewahrung', retentionValue: /Behält 7 tägliche, 4 wöchentliche und 6 monatliche Snapshots/, snapshots: 'Aufbewahrte Snapshots', last: 'Letztes Backup', connected: /Verbunden · zuletzt kopiert/ },
    weekdays: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], hasEntries: 'hat Einträge',
  },
  'fr-FR': {
    name: 'French',
    landing: { badge: /S’exécute dans un projet/, title: 'Ouvrez un projet pour lancer Code', open: 'Ouvrir Code', header: 'Nouvelle tâche', listLabel: 'Projets avec accès à Code' },
    code: { intro: /Lance un harnais de code dans un worktree git dédié/, repository: 'Dépôt', preparation: 'Préparation du prompt', direct: 'Direct', notAvailable: 'indisponible', prompt: 'Que doit-il faire ?', legend: 'Ce que cette tâche peut faire', read: 'Lire le dépôt', edit: 'Modifier des fichiers', run: 'Exécuter des commandes', install: 'Installer des dépendances', start: 'Démarrer la tâche', tasks: 'Tâches' },
    address: { h1: 'Adresse web', current: 'Adresse actuelle', earlier: 'Anciennes adresses', change: 'Modifier l’adresse', fresh: 'Nouvelle adresse', check: 'Vérifier et enregistrer' },
    features: { h1: 'Fonctionnalités', previews: 'Surfaces en aperçu', previewsDesc: /Affiche les aperçus non construits/, backups: 'Sauvegardes', diary: 'Outil d’ajout au Journal' },
    experimental: { h1: 'Expérimental', title: 'Configuration du service de décision', label: 'Point de terminaison de décision', astra: 'Relecture Astra (mode Code)' },
    backups: { h1: 'Sauvegardes', destination: 'Destination', schedule: 'Planification', scheduleValue: /Tous les jours à 02:00 \(heure du serveur\)/, retention: 'Conservation', retentionValue: /Conserve 7 instantanés quotidiens, 4 hebdomadaires et 6 mensuels/, snapshots: 'Instantanés conservés', last: 'Dernière sauvegarde', connected: /Connecté · dernière copie/ },
    weekdays: ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'], hasEntries: 'a des entrées',
  },
};
const ENGLISH = /Open a project to run Code|Code mode runs inside|Open Code|Runs in a project|Runs a coding harness|Prompt preparation|What should it do\?|What this task may do|Read the repository|Edit files|Run commands|Install dependencies|Start task|Web address|Current address|Earlier addresses|Change address|New address|Check and save|Optional capabilities|Preview surfaces|Deep research|Diary append tool|Decision service setup|Decision endpoint|Astra review|Schedule|Retention|Snapshots kept|Last backup|Daily at|Keeps 7 daily|Connected · last copied|Try alternative application logic/;

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS locale-617-619: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL locale-617-619: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); }
  };
  const errors = [];
  const text = async (locator) => (await locator.innerText()).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

  // The real registry, so the feature ids the client translates by are the ones the server sends.
  const features = createFeatures({ env: {}, store: null }).describe();
  const stamp = Date.parse('2026-09-28T02:05:00');
  const backupStatus = {
    enabled: true, ready: true, reason: null, reasonCode: null, reasonGaps: [], busy: null,
    schedule: 'Daily at 02:00 (server time)', scheduleHour: 2, retention: 'Keeps 7 daily, 4 weekly and 6 monthly snapshots', retentionPolicy: { daily: 7, weekly: 4, monthly: 6 },
    destination: 'Folder /backup/noevia, mirrored to gdrive:noevia', destinationFolder: { path: '/backup/noevia', mirror: 'gdrive:noevia' }, paths: 3,
    google: { configured: true, state: 'connected', email: 'synthetic@example.com', copy: { state: 'ok', at: stamp, message: 'Copied 5 snapshots.' } },
    lastBackup: { at: stamp, id: 's5', files: 1204, uploadedBytes: 52428800 }, lastVerify: { at: stamp, verifiedAt: stamp, id: 's5', files: 1204 }, lastError: null, snapshots: 5,
  };
  const codeState = {
    repositories: [{ id: 'noevia' }, { id: 'scratch' }], capabilities: ['read_repository', 'edit_file', 'execute_command', 'install_dependency', 'network', 'delete', 'git_push'],
    defaultCapabilities: ['read_repository', 'edit_file', 'execute_command'], harnesses: [{ id: 'opencode', label: 'OpenCode', version: '1.18.31' }],
    promptPreparation: [{ id: 'direct', label: 'Direct', available: true, reason: 'Your request goes to the model as you wrote it.' },
      { id: 'local', label: 'Local architect', available: false, reason: 'Not offered yet: synthetic.' }],
    sandboxed: true, network: false, tasks: [],
  };
  const project = { id: 'p1', name: 'Gartenplan', goal: '', instructions: '', memories: [], files: [], assets: [], chats: [], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000, modes: ['chat'] };

  // The month the calendar opens on is the current one; three synthetic entry days in it.
  const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  async function open(locale, { width = 1440, height = 950, theme = 'light' } = {}) {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((t) => { localStorage.setItem('cowork-theme', t); }, theme);
    await page.route('**/api/account/preferences', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      return route.fulfill({ response, json: { ...(await response.json()), locale } });
    });
    for (const p of ['**/api/profile', '**/api/auth/session']) {
      await page.route(p, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        return route.fulfill({ response, json: { ...body, user: { ...body.user, role: 'admin' } } });
      });
    }
    await page.route('**/api/features', (route) => route.fulfill({ json: { flags: { codeHarness: true, previews: true, offsiteBackup: true } } }));
    await page.route('**/api/workspace', (route) => route.fulfill({ json: { projects: [project], freeChats: [] } }));
    await page.route('**/api/code/active', (route) => route.fulfill({ json: { tasks: [], total: 0 } }));
    await page.route('**/api/projects/*/skills', (route) => route.fulfill({ json: { skills: [] } }));
    await page.route('**/api/projects/p1/code**', (route) => route.fulfill({ json: codeState }));
    await page.route('**/api/admin/web-address', (route) => route.fulfill({ json: { origin: 'https://noevia.example.com', source: 'settings', previous: ['https://old.example.com'], rpId: 'noevia.example.com' } }));
    await page.route('**/api/admin/features', (route) => route.fulfill({ json: { features } }));
    await page.route('**/api/admin/decision-settings', (route) => route.fulfill({ json: { url: '', timeoutMs: 1500 } }));
    await page.route('**/api/admin/offsite-backup', (route) => route.fulfill({ json: backupStatus }));
    await page.route('**/api/diary/**', async (route) => {
      const url = new URL(route.request().url()), json = (b) => route.fulfill({ json: b });
      if (url.pathname.endsWith('/source')) return json({ source: 'synthetic', months: [{ id: month }] });
      if (url.pathname.endsWith('/today')) return json({ todayLog: `# ${month}-01\nSynthetic entry\n# ${month}-02\nAnother synthetic entry`, standingSections: {} });
      return route.continue();
    });
    return { context, page };
  }
  // /code only opens once the feature flags have arrived (a direct load is bounced to chat first),
  // so open the app, let the flags land, then take the client-side route.
  async function goCode(page) {
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/features')), page.goto(`${ORIGIN}/`)]);
    await page.locator('[data-mode="code"]').first().waitFor({ state: 'attached' });
    await page.evaluate(() => { history.pushState({}, '', '/code'); dispatchEvent(new PopStateEvent('popstate')); });
  }
  const shot = async (page, name, width, theme) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${width}-${theme}.png`, fullPage: true }); };
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  for (const [locale, L] of Object.entries(LANGS)) {
    const tag = `${L.name}`;
    const { context, page } = await open(locale);

    await check(`#617 ${tag}: the Code landing (project picker) is translated`, async () => {
      await goCode(page);
      await page.getByRole('heading', { name: L.landing.title }).waitFor({ timeout: 15000 });
      const main = page.locator('.coding-workspace');
      const shown = await text(main);
      assert.match(shown, new RegExp(L.landing.header), 'the page name in the header');
      assert.match(shown, L.landing.badge);
      assert.ok(await main.getByRole('button', { name: L.landing.open }).count(), 'the open button');
      assert.equal(await main.getByRole('list', { name: L.landing.listLabel }).count(), 1, 'the project list is named in the account language');
      assert.doesNotMatch(shown, ENGLISH, shown);
    });

    await check(`#617 ${tag}: the project Code tab is translated`, async () => {
      await page.goto(`${ORIGIN}/p/p1/code`);
      await page.getByLabel(L.code.repository, { exact: true }).waitFor({ timeout: 15000 });
      const panel = page.locator('.code-panel');
      const shown = await text(panel);
      assert.match(shown, L.code.intro);
      for (const word of [L.code.preparation, L.code.prompt, L.code.legend, L.code.read, L.code.edit, L.code.run, L.code.install, L.code.start, L.code.tasks]) assert.ok(shown.includes(word), `${word} in: ${shown.slice(0, 300)}`);
      // The mode the interface knows is translated; one it does not keeps the server's own words.
      assert.deepEqual(await page.getByLabel(L.code.preparation).locator('option').evaluateAll((os) => os.map((o) => o.textContent)), [L.code.direct, `Local architect — ${L.code.notAvailable}`]);
      assert.match(await page.getByLabel(L.code.prompt).getAttribute('placeholder'), /^(Beschreibe die Aufgabe|Décrivez la tâche)/);
      assert.doesNotMatch(shown, ENGLISH, shown);
      assert.ok(await noOverflow(page), 'no horizontal overflow');
    });

    for (const section of ['address', 'features', 'experimental', 'backups']) {
      await check(`#618 ${tag}: Settings > ${section} is translated`, async () => {
        await page.goto(`${ORIGIN}/settings/${section}`);
        await page.locator('.settings-title h1').waitFor({ timeout: 15000 });
        const h1 = await text(page.locator('.settings-title h1'));
        assert.equal(h1, L[section].h1);
        if (section === 'features' || section === 'experimental') await page.locator('.feature-settings .set-row').first().waitFor();
        if (section === 'address') await page.locator('#web-address').waitFor();
        if (section === 'backups') await page.locator('.set-rows .set-row').first().waitFor();
        await page.waitForTimeout(150);
        const shown = await text(page.locator('.settings-title').locator('xpath=..'));
        assert.doesNotMatch(shown, ENGLISH, shown);
        const A = L[section];
        if (section === 'address') { for (const w of [A.current, A.earlier, A.change, A.fresh, A.check]) assert.ok(shown.includes(w), `${w} in: ${shown}`); }
        if (section === 'features') {
          assert.ok(shown.includes(A.previews), shown.slice(0, 400));
          assert.match(shown, A.previewsDesc);
          assert.ok(shown.includes(A.backups) && shown.includes(A.diary), shown.slice(0, 600));
          // Env-var names stay as they are; the "set by the operator" tail is the interface's.
          assert.doesNotMatch(shown, /Set by the operator/);
          // Every feature row is translated: no row keeps the server's English label.
          const labels = (await page.locator('.feature-settings .set-row-label').allInnerTexts()).map((s) => s.trim());
          assert.equal(labels.length, features.filter((f) => !f.experimental).length, labels.join(' | '));
          for (const f of features.filter((x) => !x.experimental)) assert.ok(!labels.includes(f.label) || (f.label === 'Backups' && locale === 'de-DE'), `${f.name} is still "${f.label}": ${labels.join(' | ')}`);
        }
        if (section === 'experimental') {
          for (const w of [A.title, A.label, A.astra]) assert.ok(shown.includes(w), `${w} in: ${shown.slice(0, 400)}`);
        }
        if (section === 'backups') {
          for (const w of [A.destination, A.schedule, A.retention, A.snapshots, A.last]) assert.ok(shown.includes(w), `${w} in: ${shown}`);
          assert.match(shown, A.scheduleValue); assert.match(shown, A.retentionValue); assert.match(shown, A.connected);
          assert.match(shown, /1[  .,]?204 (Dateien|fichiers)/);
        }
      });
    }

    await check(`#619 ${tag}: the Diary calendar has a localised heading, day names and a Monday-first week`, async () => {
      await page.goto(`${ORIGIN}/diary`);
      const heading = page.locator('.diary-calendar-heading h1');
      await heading.waitFor({ timeout: 15000 });
      const month = await text(heading);
      const expected = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(now.getFullYear(), now.getMonth(), 1, 12));
      assert.equal(month, expected.replace(/[  ]/g, ' '), 'the month heading follows the account language');
      if (locale === 'fr-FR') assert.doesNotMatch(month, /[A-Z]/, `an English or capitalised month name: ${month}`);
      const weekdays = (await page.locator('.diary-calendar .calendar-weekday').allInnerTexts()).map((s) => s.trim());
      assert.deepEqual(weekdays, L.weekdays, 'the week starts on Monday');
      // The first of the month sits under the right weekday.
      const cells = await page.locator('.diary-calendar > *').evaluateAll((els) => els.slice(7).map((e) => (e.matches('button') ? e.querySelector('span')?.textContent : '')));
      const offset = cells.indexOf('1');
      assert.equal(offset, (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7, `the 1st is in column ${offset}`);
      // The day buttons are named with a date in the account language, then the entry state.
      const label = await page.locator('.calendar-day').first().getAttribute('aria-label');
      const day1 = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(now.getFullYear(), now.getMonth(), 1, 12)).replace(/[  ]/g, ' ');
      assert.equal(label.replace(/[  ]/g, ' '), `${day1}, ${L.hasEntries}`);
      if (locale === 'fr-FR') assert.doesNotMatch(label, /September|August|July/, label);
      assert.ok(await noOverflow(page), 'no horizontal overflow');
    });
    await context.close();
  }

  // Pictures and layout at 375 / 768 / 1440, light and dark, for one language: nothing overflows.
  for (const theme of ['light', 'dark']) for (const width of [375, 768, 1440]) {
    const { context, page } = await open('fr-FR', { width, height: width < 600 ? 812 : 950, theme });
    await check(`layout ${width} ${theme}: Code, Settings and the Diary calendar do not overflow`, async () => {
      for (const [label, url, ready] of [
        ['code-landing', '/code', () => page.locator('.coding-workspace h1').waitFor()],
        ['code-tab', '/p/p1/code', () => page.locator('.code-panel #code-heading').waitFor()],
        ['settings-features', '/settings/features', () => page.locator('.feature-settings .set-row').first().waitFor()],
        ['settings-address', '/settings/address', () => page.locator('#web-address').waitFor()],
        ['settings-backups', '/settings/backups', () => page.locator('.set-rows .set-row').first().waitFor()],
        ['diary', '/diary', () => page.locator('.diary-calendar-heading h1').waitFor()],
      ]) {
        if (url === '/code') await goCode(page); else await page.goto(`${ORIGIN}${url}`);
        await ready(); await page.waitForTimeout(200);
        assert.ok(await noOverflow(page), `${label} overflows at ${width}`);
        await shot(page, label, width, theme);
      }
    });
    await context.close();
  }

  const unexpected = errors.filter((e) => !/ResizeObserver/.test(e));
  await check('no page errors', async () => assert.deepEqual(unexpected, []));
  await browser.close(); fixture.close?.();
  const failed = results.filter(([, e]) => e);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
