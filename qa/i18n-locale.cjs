// Interface translations (#231) against synthetic APIs only: no model, no inference, no Diary.
// Serves the built app from ../dist. The account preference is de-DE; the browser says en-US,
// so every German string on screen came from the saved choice, not the browser.
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core node qa/i18n-locale.cjs
// Screenshots (light): de-DE chat shell with composer and Settings → Appearance & language at
// 375 and 1440, plus fr-FR Settings at 375. Each is checked for horizontal overflow and clipped controls.
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const out = process.env.QA_SCREENSHOTS || '/tmp/i18n-shots';
const PORT = 31477;
// What each run expects on screen, in its own language.
const L = {
  'de-DE': { placeholder: 'Nachricht an noevia…', mode: 'Sitzungsmodus', add: 'Dateien und Werkzeuge hinzufügen', settings: 'Einstellungen', all: 'Alle Einstellungen', search: 'Einstellungen durchsuchen', word: 'tastenkürzel', keyboard: 'Tastatur & Eingabe', appearance: 'Darstellung & Sprache', select: 'Sprache der Oberfläche, Datum und Zahlen', note: 'Noch nicht übersetzte Bereiche erscheinen auf Englisch.', reset: 'Auf Browser zurücksetzen' },
  'fr-FR': { placeholder: 'Écrire à noevia…', mode: 'Mode de session', add: 'Ajouter des fichiers et des outils', settings: 'Réglages', all: 'Tous les réglages', search: 'Rechercher dans les réglages', word: 'raccourcis', keyboard: 'Clavier et saisie', appearance: 'Apparence et langue', select: 'Langue de l’interface, dates et nombres', note: 'Les écrans pas encore traduits s’affichent en anglais.', reset: 'Revenir au navigateur' },
};
const RUNS = [['de-DE', 375], ['de-DE', 1440], ['fr-FR', 375]];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (const [locale, width] of RUNS) {
      const l = L[locale];
      const touch = width < 800;
      const page = await browser.newPage({ viewport: { width, height: touch ? 812 : 900 }, locale: 'en-US', hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
      page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
      await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
      let prefs = { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale };
      const user = { id: 'synthetic-i18n-qa', username: 'i18nqa', displayName: 'Synthetische Person', role: 'member', diaryEnabled: false, onboarded: true };
      await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme: 'light', light: 'iris', dark: 'iris' } }));
      await page.route('**/api/account/preferences', async (r) => {
        if (r.request().method() === 'PUT') prefs = { ...prefs, ...JSON.parse(r.request().postData() || '{}') };
        return r.fulfill({ json: prefs });
      });
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [{ id: 'p1', name: 'Synthetische Recherche', updatedAt: 1000, files: [], assets: [], chats: [], toolboxes: ['core'] }], freeChats: [{ id: 'c1', title: 'Synthetische Reiseplanung', updatedAt: 1000, pinned: false, messages: [] }] } }));
      await page.goto(`http://localhost:${PORT}`);

      // The saved locale reaches the composer and <html lang> without a reload.
      const composer = page.getByPlaceholder(l.placeholder);
      await composer.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.lang), locale);
      await page.getByRole('radiogroup', { name: l.mode }).waitFor();
      assert.ok(await page.getByRole('button', { name: l.add }).isVisible());
      const check = async (name) => {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const state = await page.evaluate(() => {
          const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
          // Clipped: content wider than its box (whatever its overflow setting), or a box that sticks
          // out past the box that clips it. Segmented tracks scroll sideways by design.
          const scrolls = (e) => /auto|scroll/.test(getComputedStyle(e).overflowX);
          const clipped = [...document.querySelectorAll('button, [role="radio"], .set-row-label, .set-row-desc, .composer-mode-harness, .composer-hint, label, .settings-nav-title, h1, h2, select, .route-note')]
            .filter((e) => e.offsetParent && e.getClientRects().length && !e.closest('.chat-row, .proj-row, .model-pill, [hidden]'))
            .filter((e) => {
              if (e.scrollWidth > e.clientWidth + 1 && !scrolls(e)) return true;
              // A box that sticks out past the nearest ancestor that clips it (or the viewport) is cut off.
              let clip = e.parentElement;
              while (clip && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement;
              // Only a segmented track scrolls sideways by design; any other clipping box counts.
              if (clip && clip.classList.contains('glass-seg')) return false;
              const r = e.getBoundingClientRect(), p = clip ? clip.getBoundingClientRect() : { left: 0, right: window.innerWidth };
              return r.right > Math.min(p.right, window.innerWidth) + 1 || r.left < Math.max(p.left, 0) - 1;
            })
            .map((e) => { return `${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60)} [${e.tagName}.${e.className}]`; });
          return { overflow, clipped };
        });
        assert.equal(state.overflow, false, `${width} ${name}: horizontal overflow`);
        assert.deepEqual(state.clipped, [], `${width} ${name}: clipped ${state.clipped.join(' | ')}`);
        await page.screenshot({ path: path.join(out, `${locale}-light-${width}-${name}.png`) });
      };
      if (locale === 'de-DE') await check('chat-composer');

      // Settings → Appearance & language, in the run's language.
      await page.getByTitle(l.settings, { exact: true }).first().click();
      const settings = page.getByRole('region', { name: l.settings, exact: true });
      await settings.waitFor();
      const back = settings.getByRole('button', { name: l.all, exact: true });
      if (await back.isVisible()) await back.click();
      // Search finds a page by a German task word, and by the English one.
      const search = settings.getByLabel(l.search);
      await search.fill(l.word);
      await settings.getByRole('button', { name: l.keyboard, exact: true }).waitFor();
      await search.fill('shortcuts');
      await settings.getByRole('button', { name: l.keyboard, exact: true }).waitFor();
      await search.fill('');
      await settings.locator('.settings-navigation').getByRole('button', { name: l.appearance, exact: true }).click();
      const select = settings.getByLabel(l.select);
      await select.waitFor();
      assert.equal(await select.inputValue(), locale);
      await settings.getByText(l.note, { exact: false }).waitFor();
      await select.scrollIntoViewIfNeeded();
      await check('settings-appearance-language');

      // Switching back to the browser's language re-renders at once, with no reload.
      await settings.getByRole('button', { name: l.reset, exact: true }).click();
      await page.getByRole('region', { name: 'Settings', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en-US');
      assert.equal(prefs.locale, 'system');
      await page.close();
    }
    // #283: since #281 a 'system' locale preference follows the browser, and Playwright's own
    // default locale is en-US — every other QA script now needs an en-GB context (qa-locale.cjs)
    // to see the British labels it asserts on. Prove both spellings actually work: the sidebar's
    // Customise/Customize button under an en-US browser vs. an en-GB one (account preference left
    // at 'system' throughout, i.e. the default a fresh browser gets).
    for (const [locale, label] of [['en-US', 'Customize'], ['en-GB', 'Customise']]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale });
      page.on('pageerror', (e) => errors.push(`${locale} sidebar: ${e.message}`));
      const user = { id: 'synthetic-locale-qa', username: 'localeqa', displayName: 'Synthetic Locale QA', role: 'member', diaryEnabled: false, onboarded: true };
      await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme: 'light', light: 'iris', dark: 'iris' } }));
      await page.route('**/api/account/preferences', (r) => r.fulfill({ json: { notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'system' } }));
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [] } }));
      await page.goto(`http://localhost:${PORT}`);
      await page.getByRole('button', { name: label, exact: true }).waitFor();
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(`i18n locale QA passed; screenshots in ${out}`);
  } finally { await browser.close(); await fixture.close?.(); }
})().catch((e) => { console.error(e); process.exit(1); });
