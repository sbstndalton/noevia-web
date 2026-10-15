'use strict';
// #1804: Decision service setup was drawn only on Settings > Experimental, so an administrator following
// the Models page ('Set in Settings, Decision service setup') could not find it from the navigation or
// Settings search. It controls live routing, so it now lives on Settings > Models and routing, next to
// the routing summary, and search finds that page by 'decision'. Experimental keeps only the experiments;
// an experiment that needs the decision service says where to set it up. The Models page row names the
// page too.
//
// 2000 and 390 px, light and dark. Offline: the app is built from this checkout; the decision settings,
// feature and overview routes are noevia-core's real code over an in-memory store (models-state-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/decision-setup-1804.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openSettings, openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, VIEWS, SHOTS } = require('./models-state-fixture.cjs');

const SAVED = 'http://192.168.1.20:8040';

run('decision-setup-1804', Number(process.env.QA_PORT || 31804), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState({ savedDecisionUrl: SAVED });
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });

      await check(`${tag}: Settings search for 'decision' leads to Decision service setup on Models and routing`, async () => {
        await page.goto(origin);
        await openSettings(page);
        const settings = page.getByRole('dialog', { name: 'Settings' });
        await settings.getByRole('textbox', { name: 'Search settings' }).fill('decision');
        const entry = settings.getByRole('navigation').getByRole('button', { name: 'Models and routing', exact: true });
        await entry.waitFor({ timeout: 5000 });
        await entry.click();
        const section = settings.getByRole('region', { name: 'Decision service setup' });
        await section.getByRole('textbox', { name: 'Decision endpoint' }).waitFor({ timeout: 10000 });
        await page.waitForFunction(() => document.querySelector('#decision-url')?.value);
        assert.equal(await section.getByRole('textbox', { name: 'Decision endpoint' }).inputValue(), SAVED);
        // It sits on the page with the routing summary and the way into the model manager.
        await settings.getByRole('button', { name: 'Open model manager', exact: true }).waitFor();
        if (SHOTS) {
          await section.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1804-settings-models-${width}-${theme}.png`) });
        }
      });

      await check(`${tag}: Experimental has the experiments only, and an unavailable one says where to set the service up`, async () => {
        // Core's own reason when no decision service is set up (decision-settings.cjs), on one experiment.
        const REASON = 'Set up the decision service below before enabling this experiment.';
        await page.route('**/api/admin/features', async (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const out = await state.handle('GET', '/api/admin/features');
          const first = out.body.features.find((f) => f.experimental);
          Object.assign(first, { unavailable: REASON, unavailableId: 'decisionSetup', enabled: false });
          await route.fulfill({ status: out.status, json: out.body });
        });
        await page.goto(`${origin}/settings/experimental`);
        await page.locator('.feature-settings .set-row').first().waitFor({ timeout: 15000 });
        assert.equal(await page.getByRole('region', { name: 'Decision service setup' }).count(), 0, 'one home for the setup');
        const shown = await page.locator('.feature-settings').innerText();
        assert.ok(shown.includes('Set up the decision service in Settings, Models and routing, before enabling this experiment.'), `the experiment says where to set it up: ${shown.slice(0, 600)}`);
        assert.doesNotMatch(shown, /decision service below/, 'no experiment points "below" to a setup that is not there');
        await page.unroute('**/api/admin/features');
      });

      await check(`${tag}: the Models page Decision row names the Settings page that holds it`, async () => {
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Your models');
        const overview = root.getByRole('region', { name: 'What each service uses' });
        const row = overview.locator('[data-service="decision"]');
        await row.waitFor({ timeout: 15000 });
        assert.equal((await row.locator('.mm-assign-control').innerText()).trim(), 'Set in Settings, Models and routing, Decision service setup.');
        if (SHOTS) {
          await row.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1804-models-row-${width}-${theme}.png`) });
        }
      });
      assert.deepEqual(errors, []);
      await page.close();

      // Review of web#63: a member who deep-links to /settings/models (or has it as their last section)
      // never mounts the setup: no admin request, no 403 alert flashed before the redirect.
      await check(`${tag}: a member deep-linking to Models and routing never calls the admin decision API`, async () => {
        const member = await openPage(browser, state, { width, height, theme });
        const admin = [];
        const user = { id: 'qa-member', username: 'qa-member', displayName: 'Synthetic member', role: 'member', diaryEnabled: true, onboarded: true };
        await member.page.route(/\/api\/(profile|auth\/session)$/, (r) => r.fulfill({ json: { user, passkeys: [] } }));
        await member.page.route('**/api/admin/**', (r) => { admin.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`); return r.fulfill({ status: 403, json: { error: 'Administrators only.' } }); });
        const alerts = [];
        await member.page.exposeFunction('qaAlert', (text) => alerts.push(text));
        await member.page.addInitScript(() => {
          new MutationObserver(() => { for (const a of document.querySelectorAll('[role=alert]')) if (!a.dataset.qaSeen) { a.dataset.qaSeen = '1'; window.qaAlert(a.textContent); } })
            .observe(document, { childList: true, subtree: true, characterData: true });
        });
        await member.page.goto(`${origin}/settings/models`);
        await member.page.locator('.settings-title h1').waitFor({ timeout: 15000 });
        await member.page.waitForTimeout(1200);
        assert.deepEqual(admin, [], 'no admin request');
        assert.equal(await member.page.locator('.decision-service-settings').count(), 0, 'the setup is not mounted');
        // The synthetic member has no saved appearance (an unrelated notice); any alert about the decision
        // service or the admin refusal is the bug.
        const decisionAlerts = alerts.filter((a) => /decision|Administrators only|403|forbidden/i.test(a));
        assert.deepEqual(decisionAlerts, [], `no decision-service alert: ${JSON.stringify(alerts)}`);
        await member.page.close();
      });
    } finally { state.close(); }
  }
});
