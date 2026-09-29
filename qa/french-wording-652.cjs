// #652: French wording leftovers, in the browser.
//   1. Settings -> Models: the engine's rate reads "jetons/s" (not "tok/s"), and the Auto routing row names
//      the smart role "Intelligent", the word the chat composer beside it uses (not "Avancé")
//   2. the same word in the composer and in the Models page's own Routing tab
//   3. Settings -> Journal et stockage: the file-sharing "not configured" reason is French (German too),
//      from the server's reason id; an id this client does not know keeps the English sentence
//
// The real application server on synthetic data (no file-sharing endpoint configured, which is what
// produces the reason). The engine rate and the Auto roles are answered in the page with synthetic values.
//
// Run: [APP_DIR=<web dir of a built app>] [QA_SCREENSHOTS=<dir>] node qa/french-wording-652.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { start, signedIn } = require('./sources-panel-lib.cjs');

(async () => {
  let env;
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const failures = [], errors = [];
  const shots = process.env.QA_SCREENSHOTS;
  const check = async (name, fn) => {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  };
  try {
    env = await start({ port: 31652, name: 'frwording652' });
    const first = await signedIn(browser, env, { width: 1440, theme: 'light', projectName: 'Synthetic wording' });
    assert.equal((await first.api('/api/profile/features', { diaryEnabled: true }, 'PUT')).status, 200);
    const storage = await first.ctx.storageState();
    await first.ctx.close();

    const open = async (locale, theme, width) => {
      const ctx = await browser.newContext({ locale, viewport: { width, height: 900 }, storageState: storage });
      await ctx.addInitScript((t) => { localStorage.setItem('cowork-theme', t); localStorage.removeItem('noevia:last-view'); }, theme);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${locale}: ${e.message}`));
      await page.route('**/api/auto-roles', (route) => route.fulfill({ json: { configured: true, roles: { fast: 'synthetic-fast', smart: 'synthetic-smart' } } }));
      await page.route('**/api/stats', async (route) => {
        const response = await route.fetch().catch(() => null);
        const body = response && response.ok() ? await response.json().catch(() => ({})) : {};
        return route.fulfill({ json: { ...body, tokensPerSecond: 41.5 } });
      });
      return { ctx, page };
    };

    for (const [width, theme] of [[1440, 'light'], [375, 'dark']]) {
      const { ctx, page } = await open('fr-FR', theme, width);
      await check(`#652 fr-FR Settings -> Models: "jetons/s" and the smart role's one name (${width} ${theme})`, async () => {
        await page.goto(`${env.origin}/settings/models`);
        await page.getByText(/Rapide : synthetic-fast/).first().waitFor({ timeout: 20000 });
        const rows = await page.locator('.mm-summary .set-rows').innerText();
        assert.match(rows, /jetons\/s au dernier relevé/, `the rate row: ${rows}`);
        assert.doesNotMatch(rows, /tok\/s/);
        assert.match(rows, /Rapide : synthetic-fast · Intelligent : synthetic-smart/, `the routing row: ${rows}`);
        assert.doesNotMatch(rows, /Avancé/);
        if (shots) await page.screenshot({ path: `${shots}/fr-models-${width}-${theme}.png` });
      });
      if (width === 1440) {
        await check('#652 fr-FR the composer says Intelligent too', async () => {
          await page.goto(env.origin);
          await page.locator('.composer').first().waitFor({ timeout: 20000 });
          // The model pill splits a long name into a head and a tail, so read the DOM text, not the rendered one.
          const text = await page.locator('.composer').first().evaluate((el) => el.textContent);
          assert.match(text, /Rapide\/Intelligent/, text);
          assert.doesNotMatch(text, /Avancé/);
        });
        await check('#652 fr-FR the Models page Routing tab names the same role', async () => {
          await page.goto(`${env.origin}/models`);
          await page.getByRole('tab', { name: /Routage|Routing/i }).first().click().catch(async () => { await page.getByText(/Routage/).first().click(); });
          await page.waitForTimeout(600);
          const text = await page.locator('.mm-root').innerText();
          assert.match(text, /Intelligent/);
          assert.doesNotMatch(text, /Avancé —|à Avancé|ou Avancé|et Avancé/, 'the smart role is not called Avancé');
        });
      }
      await ctx.close();
    }

    for (const [locale, title, sentence, english] of [
      ['fr-FR', 'Partage des fichiers du Journal', /L’opérateur n’a pas configuré de point d’accès pour le partage de fichiers\. Le partage reste désactivé\./, /The operator has not configured/],
      ['de-DE', 'Tagebuch-Dateifreigabe', /Der Betreiber hat keinen Endpunkt für die Dateifreigabe eingerichtet\. Die Freigabe bleibt aus\./, /The operator has not configured/],
    ]) {
      const { ctx, page } = await open(locale, 'light', 1440);
      await check(`#652 ${locale} Settings -> Diary & storage: the file-sharing reason is translated`, async () => {
        await page.goto(`${env.origin}/settings/diary`);
        // The panel is a <section aria-label="<its title>">; its reason paragraph arrives with the sharing read.
        const sharing = page.locator(`section[aria-label="${title}"]`);
        await sharing.waitFor({ timeout: 20000 });
        await sharing.locator('p.route-note').nth(2).waitFor({ timeout: 20000 });
        const text = await sharing.innerText();
        assert.match(text, sentence, `the sharing section: ${text}`);
        assert.doesNotMatch(text, english);
        if (shots) await sharing.screenshot({ path: `${shots}/${locale}-sharing.png` });
      });
      await ctx.close();
    }

    // An id the client does not know: the English sentence the server sent alongside it is shown, not blank.
    {
      const { ctx, page } = await open('fr-FR', 'light', 1440);
      await page.route('**/api/profile/sharing', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        return route.fulfill({ response, json: { ...(await response.json()), reasonId: 'some-future-reason', reason: 'A future English reason.' } });
      });
      await check('#652 an unknown reason id keeps the English fallback sentence', async () => {
        await page.goto(`${env.origin}/settings/diary`);
        await page.getByText('A future English reason.', { exact: false }).first().waitFor({ timeout: 20000 });
      });
      await ctx.close();
    }
    assert.deepEqual(errors.filter((e) => !/ResizeObserver/.test(e)), [], 'page errors');
    if (failures.length) { console.log(`FAIL french-wording-652: ${failures.length} check(s) failed`); process.exitCode = 1; }
    else console.log('PASS #652 French says jetons/s and Intelligent, and the sharing reason is translated.');
  } finally { await browser.close(); if (env) await env.stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
