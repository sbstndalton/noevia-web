'use strict';
// #1796: Settings → Models said Decision = laya_multilingual_f16 (a stale preset marked as Laya) while
// every decision went to Kev. The Decision row now names the model decisions are sent to (the decision
// settings plus COWORK_DECISION_MODEL: kev-0.8b) and a Sensitivity check row names its own service's
// (Laya). Both say "Configured", not "Running": core only knows an address is set up (review of web#60).
// A decision address saved in Settings says so; the stale preset name is gone from the overview.
//
// Offline: the app is built from this checkout; the overview comes from noevia-core's real code with the
// live deployment's decision configuration and synthetic everything else (models-state-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-decision-row-1796.cjs
// Fails on a build (core + web) without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, VIEWS, SHOTS, TAG, STALE_LAYA } = require('./models-state-fixture.cjs');

const rowText = async (overview, id) => {
  const row = overview.locator(`[data-service="${id}"]`);
  await row.waitFor({ timeout: 5000 });
  return { label: (await row.locator('.mm-assign-label').textContent()).trim(), model: (await row.locator('.mm-assign-model').textContent()).trim(),
    state: (await row.locator('.mm-state').textContent()).trim(), note: ((await row.locator('.mm-assign-control').textContent()) || '').trim() };
};

run('models-decision-row-1796', Number(process.env.QA_PORT || 31796), async (check, browser, origin) => {
  const state = await createState();
  try {
    for (const [width, height, theme] of VIEWS) {
      const tag = `${width} px ${theme}`;
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      const root = await openModelsPage(page, origin, { direct: true });
      await openModelsTab(root, 'Your models');
      const overview = root.getByRole('region', { name: 'What each service uses' });
      await overview.locator('.mm-assign-list').waitFor({ timeout: 15000 });

      await check(`${tag}: Decision is kev-0.8b from the deployment, Sensitivity check is laya`, async () => {
        assert.deepEqual(await rowText(overview, 'decision'), { label: 'Decision', model: 'kev-0.8b', state: 'Configured', note: 'Set in the server configuration.' });
        assert.deepEqual(await rowText(overview, 'sensitivity'), { label: 'Sensitivity check', model: 'laya', state: 'Configured', note: 'Set in the server configuration.' });
      });
      await check(`${tag}: the embedding row, whose model is really loaded, still says Running`, async () => {
        assert.equal((await rowText(overview, 'embedding')).state, 'Running');
      });
      await check(`${tag}: the stale ${STALE_LAYA} value is not in the overview`, async () => {
        assert.equal(await overview.getByText(STALE_LAYA).count(), 0);
        if (SHOTS) {
          await overview.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1796-decision-rows-${TAG}-${width}-${theme}.png`), fullPage: width > 1000 });
        }
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { state.close(); }

  // An address an administrator saved in Settings is not the deployment's: Laya-profile requests, and the row says where it is set.
  const saved = await createState({ savedDecisionUrl: 'http://192.168.1.20:8040' });
  try {
    const { page } = await openPage(browser, saved, { width: 2000, height: 1250, theme: 'light' });
    const root = await openModelsPage(page, origin, { direct: true });
    await openModelsTab(root, 'Your models');
    const overview = root.getByRole('region', { name: 'What each service uses' });
    await overview.locator('.mm-assign-list').waitFor({ timeout: 15000 });
    await check('a decision address saved in Settings: the row says so and names the model it is sent as', async () => {
      const d = await rowText(overview, 'decision');
      assert.deepEqual([d.model, d.note], ['laya', 'Set in Settings, Models and routing, Decision service setup.']);
      assert.equal((await rowText(overview, 'sensitivity')).model, 'laya');
    });
    await page.close();
  } finally { saved.close(); }
});
