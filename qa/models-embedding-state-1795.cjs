'use strict';
// #1795: the Embedding row of "What each service uses" said Running while the in-use embedding model's
// card right under it said Unloaded. Both now read the managed embedding service's own report
// (noevia-core): loaded → the row says Running and the card Loaded; not loaded → both say Unloaded.
//
// Offline: the app is built from this checkout; the installed list and the overview come from
// noevia-core's real code over a synthetic model manager and embedding service (models-state-fixture.cjs).
// The model manager's backend probe does not list the managed embed container, as on the live server.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-embedding-state-1795.cjs
// Fails on a build (core + web) without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, VIEWS, SHOTS, TAG, EMBED } = require('./models-state-fixture.cjs');

const readPair = async (root) => {
  const overview = root.getByRole('region', { name: 'What each service uses' });
  const row = overview.locator('[data-service="embedding"]');
  await row.waitFor({ timeout: 15000 });
  const card = root.getByRole('article', { name: EMBED });
  await card.waitFor({ timeout: 15000 });
  return { row: (await row.locator('.mm-state').textContent()).trim(), model: (await row.locator('.mm-assign-model').textContent()).trim(), card: (await card.locator('.model-card-state').textContent()).trim(), cardEl: card };
};

run('models-embedding-state-1795', Number(process.env.QA_PORT || 31795), async (check, browser, origin) => {
  for (const embedLoaded of [true, false]) {
    const state = await createState({ embedLoaded });
    try {
      for (const [width, height, theme] of (embedLoaded ? VIEWS : VIEWS.slice(0, 1))) {
        const tag = `${width} px ${theme}, service reports it ${embedLoaded ? 'loaded' : 'not loaded'}`;
        const { page, errors } = await openPage(browser, state, { width, height, theme });
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Your models');
        await check(`${tag}: the Embedding row and the ${EMBED} card agree`, async () => {
          const got = await readPair(root);
          assert.equal(got.model, EMBED);
          if (embedLoaded) assert.deepEqual([got.row, got.card], ['Running', 'Loaded']);
          else assert.deepEqual([got.row, got.card], ['Unloaded', 'Unloaded']);
          if (SHOTS) {
            await root.getByRole('region', { name: 'What each service uses' }).scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(SHOTS, `1795-embedding-${embedLoaded ? 'loaded' : 'unloaded'}-${TAG}-${width}-${theme}.png`), fullPage: width > 1000 });
          }
        });
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally { state.close(); }
  }
});
