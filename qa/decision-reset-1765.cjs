'use strict';
// #1765: a decision-service address saved in Settings replaced COWORK_DECISION_URL for good: there was no
// way back. Decision service setup now says where the active address comes from and, while one is saved
// here, offers "Use deployment default", which forgets it (DELETE /api/admin/decision-settings, audited):
// the field shows the deployment's address again, the button goes, and focus lands on the result.
//
// Offline: the app is built from this checkout; the decision settings and feature routes are noevia-core's
// real code over an in-memory store with the live deployment's environment (models-state-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/decision-reset-1765.cjs
// Fails on a build (core + web) without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, TAG } = require('./models-state-fixture.cjs');

const SAVED = 'http://192.168.1.20:8040';

run('decision-reset-1765', Number(process.env.QA_PORT || 31765), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState({ savedDecisionUrl: SAVED });
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      // #1804: the setup lives on Models and routing.
      await page.goto(`${origin}/settings/models`);
      const section = page.getByRole('region', { name: 'Decision service setup' });
      const url = section.getByRole('textbox', { name: 'Decision endpoint' });
      await url.waitFor({ timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('#decision-url')?.value);

      await check(`${tag}: a saved address says it replaces the deployment's, with "Use deployment default"`, async () => {
        assert.equal(await url.inputValue(), SAVED);
        await section.getByText("This address is saved here and replaces the deployment's decision service.").waitFor({ timeout: 2000 });
        assert.equal(await section.getByRole('button', { name: 'Use deployment default' }).count(), 1);
        assert.equal(await section.locator('[role=status]').filter({ hasText: 'saved here' }).count(), 0, 'static text is not a live region');
        if (SHOTS) {
          await section.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1765-saved-${TAG}-${width}-${theme}.png`) });
        }
      });

      await check(`${tag}: "Use deployment default" forgets it; the deployment's address is back, audited, focus on the section heading`, async () => {
        await section.getByRole('button', { name: 'Use deployment default' }).click();
        const done = section.getByRole('status').filter({ hasText: "The deployment's decision service is used again." });
        await done.waitFor({ timeout: 5000 });
        assert.equal(await url.inputValue(), 'http://kev:11435');
        await section.getByText("This is the deployment's decision service.").waitFor({ timeout: 2000 });
        assert.equal(await section.getByRole('button', { name: 'Use deployment default' }).count(), 0, 'nothing saved here to reset any more');
        // Review of web#60: focus goes to the section heading, never to the live region as it mounts (read twice).
        await page.waitForFunction(() => document.activeElement?.id === 'decision-setup-title');
        assert.equal(await done.evaluate((el) => el === document.activeElement || el.hasAttribute('tabindex')), false, 'the status line is not focused or focusable');
        assert.equal(await section.getByRole('status').count(), 1, 'one live region announces the result');
        assert.equal(state.values.has('decision:configuration'), false, 'the stored key is gone');
        assert.equal(state.audits.at(-1)[0], 'decision.reset');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1765-reset-${TAG}-${width}-${theme}.png`) });
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); }
  }
});
