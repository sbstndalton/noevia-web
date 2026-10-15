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

    // #1761 review: the project rail, the project's default-model picker, the composer's model label and the
    // Performance tab's memory-budget table did not know about sleeping models either. The sleeping
    // Qwen3.5-9B is listed first, so `find(m => m.loaded)` picked it.
    for (const [width, height, theme] of VIEWS) {
      const tag = `${width} px ${theme}`;
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      const project = { id: 'qa1761', name: 'QA-1761 project', goal: '', instructions: '', memories: [], model: '', routing: 'manual', files: [], assets: [], sourceFolders: [], modes: ['chat'], toolboxes: ['core'], createdAt: 1000, updatedAt: 1000,
        chats: [{ id: 'qc1761', title: 'QA-1761 chat', preview: 'QA-1761 chat', updatedAt: 5000, archived: false, pinned: false, messages: [] }] };
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [project], freeChats: [] } }));
      await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
      await page.route('**/api/models/inference-budget', (r) => r.fulfill({ json: { budgetGib: 16, models: [
        { model: 'Qwen3.5-9B', loaded: true, sleeping: true, system: false, labels: [], estimate: { totalGib: 7.1 }, fits: true },
        { model: 'Qwen3.5-4B', loaded: true, sleeping: false, system: false, labels: [], estimate: { totalGib: 3.2 }, fits: true }] } }));
      if (width > 1000) {
        await page.goto(`${origin}/c/qc1761`);
        const rail = page.locator('#noevia-inspector');
        await check(`${tag}: the project rail names the loaded model, not the sleeping one`, async () => {
          await rail.getByText('Qwen3.5-4B').first().waitFor({ timeout: 15000 });
          assert.equal(await rail.getByText('Qwen3.5-9B').count(), 0);
        });
        await check(`${tag}: the composer's model label is the loaded model`, async () => {
          const label = page.locator('.composer-model').first();
          await label.waitFor({ timeout: 15000 });
          assert.match((await label.textContent()).trim(), /^Qwen3\.5-4B/);
          const composer = label;
          assert.equal(await composer.getByText('Qwen3.5-9B').count(), 0);
        });
        await check(`${tag}: the project's default-model picker does not call the sleeping model loaded`, async () => {
          await rail.getByRole('button', { name: 'Edit project instructions' }).click();
          const dialog = page.locator('dialog.edit-project-modal');
          await dialog.waitFor({ timeout: 5000 });
          const options = await dialog.locator('select option').allTextContents();
          assert.ok(options.includes('Qwen3.5-4B · loaded'), options.join(' | '));
          assert.ok(options.includes('Qwen3.5-9B'), options.join(' | '));
        });
      }
      await check(`${tag}: the memory-budget table does not mark the sleeping model loaded`, async () => {
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Performance');
        const table = root.locator('section[aria-labelledby="mm-budget-title"] table');
        await table.waitFor({ timeout: 10000 });
        const cells = (await table.locator('tbody td:first-child').allTextContents()).map((x) => x.trim());
        assert.deepEqual(cells, ['Qwen3.5-9B', 'Qwen3.5-4B (loaded)']);
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { state.close(); }
});
