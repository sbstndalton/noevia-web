'use strict';
// #1761: a chat model llama.cpp put to sleep after its idle time (#1747) reports `loaded: true` with
// `status: 'sleeping'` (noevia-core #1758). The Models page said "Loaded" for it. Now its card and its
// role row in "What each service uses" say "Sleeping", the card says what that means, and the "Loaded"
// filter leaves it out; a model that really is loaded still says "Loaded".
//
// Offline: the app is built from this checkout, the installed list and the overview come from
// noevia-core's real code over a synthetic model manager (models-state-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-sleeping-1761.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, VIEWS, SHOTS, TAG } = require('./models-state-fixture.cjs');

run('models-sleeping-1761', Number(process.env.QA_PORT || 31761), async (check, browser, origin) => {
  const state = await createState();
  try {
    for (const [width, height, theme] of VIEWS) {
      const tag = `${width} px ${theme}`;
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      const root = await openModelsPage(page, origin, { direct: true });
      await openModelsTab(root, 'Your models');
      const sleeping = root.getByRole('article', { name: 'Qwen3.5-9B' });
      await sleeping.waitFor({ timeout: 15000 });

      await check(`${tag}: the sleeping model's card says Sleeping, not Loaded, and what that means`, async () => {
        const pill = sleeping.locator('.model-card-state');
        assert.equal((await pill.textContent()).trim(), 'Sleeping');
        await sleeping.getByText('Idle, so its memory was freed. The next request loads it again in a few seconds.').waitFor({ timeout: 2000 });
        assert.equal(await sleeping.getAttribute('data-state'), 'sleeping');
        assert.equal(await sleeping.locator('[role=status]').filter({ hasText: 'Idle' }).count(), 0, 'static text is not a live region');
      });

      await check(`${tag}: a model that really is loaded still says Loaded`, async () => {
        const loaded = root.getByRole('article', { name: 'Qwen3.5-4B' });
        assert.equal((await loaded.locator('.model-card-state').textContent()).trim(), 'Loaded');
      });

      await check(`${tag}: the Smart and Code rows of the overview say Sleeping for it`, async () => {
        const overview = root.getByRole('region', { name: 'What each service uses' });
        for (const role of ['smart', 'code']) assert.equal((await overview.locator(`[data-role="${role}"] .mm-state`).textContent()).trim(), 'Sleeping', role);
        assert.equal((await overview.locator('[data-role="fast"] .mm-state').textContent()).trim(), 'Loaded');
        if (SHOTS) {
          await sleeping.scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1761-sleeping-${TAG}-${width}-${theme}.png`) });
        }
      });

      await check(`${tag}: the Loaded filter leaves the sleeping model out`, async () => {
        await root.getByRole('combobox', { name: 'Filter models' }).selectOption('loaded');
        await root.getByRole('article', { name: 'Qwen3.5-4B' }).waitFor({ timeout: 3000 });
        assert.equal(await root.getByRole('article', { name: 'Qwen3.5-9B' }).count(), 0);
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { state.close(); }
});
