'use strict';
// #1665: the Reranker row of Settings → Models had no switch ("Set in the server configuration."). An administrator now
// turns reranking on or off and picks the reranker right on the row; the server saves it over the deployment's RERANK_*
// configuration (audited), and "Use deployment default" puts the deployment's back. No address reaches the page.
// #1666: Decision service setup gains a "Decision model" choice (automatic, the built-in model, Kev-0.8B), saved with the
// address only when the administrator saves; the Decision row then names that model and where it is set.
// #1667: a Creative chat role sits beside Fast, Smart, Code and Vision in the overview and in Routing.
// Members see the rows read-only and never call the admin endpoints, also when they deep-link (#1804 review).
//
// Offline: the app is built from this checkout; the overview, the reranker switch, the auto-roles and the decision
// settings are noevia-core's REAL routes over an in-memory store with the live deployment's environment
// (models-state-fixture.cjs). Synthetic everything: no reranker, no decision service, no model runs.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-switches-1665-1666-1667.cjs
// Fails on a build (core + web) without the change, passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { createState, openPage, run, VIEWS, SHOTS, TAG } = require('./models-state-fixture.cjs');

const shot = async (page, name, width, theme, el) => {
  if (!SHOTS) return;
  if (el) await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500); // let a dialog finish opening
  await page.screenshot({ path: path.join(SHOTS, `${name}-${TAG}-${width}-${theme}.png`) });
};
const overviewOf = async (page, origin) => {
  const root = await openModelsPage(page, origin, { direct: true });
  await openModelsTab(root, 'Your models');
  const overview = root.getByRole('region', { name: 'What each service uses' });
  await overview.locator('.mm-assign-list').waitFor({ timeout: 15000 });
  return overview;
};

run('models-switches-1665-1666-1667', Number(process.env.QA_PORT || 31665), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState({ rerank: true });
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      let overview = await overviewOf(page, origin);
      const reranker = overview.locator('[data-service="reranker"]');

      await check(`${tag}: #1665 the Reranker row has an on/off switch and the reranker choice, from the server configuration`, async () => {
        const toggle = reranker.getByRole('switch', { name: 'Reranking' });
        await toggle.waitFor({ timeout: 3000 });
        assert.equal(await toggle.isChecked(), true);
        const pick = reranker.getByRole('combobox', { name: 'Reranker model' });
        assert.equal(await pick.locator('option:checked').textContent(), 'gte-multilingual-reranker-base');
        await reranker.getByText('From the server configuration.').waitFor({ timeout: 2000 });
        assert.equal(await reranker.getByText('Set in the server configuration.').count(), 0);
        assert.equal(await reranker.getByRole('button', { name: 'Use deployment default' }).count(), 0, 'nothing saved here yet');
        assert.doesNotMatch(await overview.textContent(), /rerank\.invalid|http:\/\//, 'no address on the page');
        await shot(page, '1665-reranker-on', width, theme, reranker);
      });

      await check(`${tag}: #1665 turning reranking off applies, is audited, and "Use deployment default" puts it back`, async () => {
        await reranker.getByRole('switch', { name: 'Reranking' }).click();
        await overview.getByRole('status').filter({ hasText: 'Reranking is off. Project search ranks results without it.' }).waitFor({ timeout: 5000 });
        await reranker.locator('.mm-state', { hasText: 'Off' }).waitFor({ timeout: 5000 });
        assert.equal(await reranker.getByRole('switch', { name: 'Reranking' }).isChecked(), false);
        await reranker.getByText('Set here; replaces the server configuration.').waitFor({ timeout: 2000 });
        assert.deepEqual(state.audits.at(-1).slice(0, 3), ['rerank.configure', 'qa-admin', { enabled: false, backend: 'tei', model: 'gte-multilingual-reranker-base' }]);
        await shot(page, '1665-reranker-off', width, theme, reranker);
        await reranker.getByRole('button', { name: 'Use deployment default' }).click();
        await overview.getByRole('status').filter({ hasText: "The server configuration's reranker setting applies again." }).waitFor({ timeout: 5000 });
        await reranker.locator('.mm-state', { hasText: 'Running' }).waitFor({ timeout: 5000 });
        assert.equal(await reranker.getByRole('button', { name: 'Use deployment default' }).count(), 0);
        assert.equal(state.values.has('rerank:configuration'), false);
        assert.equal(state.audits.at(-1)[0], 'rerank.reset');
      });

      await check(`${tag}: #1667 a Creative role row sits with the chat roles and saves through the real auto-roles route`, async () => {
        const row = overview.locator('[data-role="creative"]');
        await row.waitFor({ timeout: 3000 });
        assert.equal((await row.locator('.mm-assign-label').textContent()).trim(), 'Creative');
        const pick = row.getByRole('combobox', { name: 'Creative' });
        assert.equal(await pick.inputValue(), '', 'unassigned: None');
        await pick.selectOption('Qwen3.5-4B');
        await overview.getByRole('status').filter({ hasText: 'Saved.' }).waitFor({ timeout: 5000 });
        assert.equal(state.workspace.autoRoles.creative, 'Qwen3.5-4B');
        assert.equal(state.workspace.autoRoles.code, 'Qwen3.5-9B', 'the other roles are kept');
        await shot(page, '1667-creative-row', width, theme, row);
      });

      await check(`${tag}: #1666 the Decision row tells an administrator where to choose its model`, async () => {
        const row = overview.locator('[data-service="decision"]');
        assert.equal((await row.locator('.mm-assign-control').textContent()).trim(), 'Choose its address and model in Settings, Models and routing, Decision service setup.');
      });

      await check(`${tag}: #1666 Decision service setup chooses the decision model; it applies only on Save, audited`, async () => {
        await page.goto(`${origin}/settings/models`);
        const section = page.getByRole('region', { name: 'Decision service setup' });
        const model = section.getByRole('combobox', { name: 'Decision model' });
        await model.waitFor({ timeout: 15000 });
        await page.waitForFunction(() => document.querySelector('#decision-url')?.value);
        const options = await model.locator('option').allTextContents();
        assert.deepEqual(options, ['Automatic (deployment: Kev-0.8B)', 'Built-in decision model', 'Kev-0.8B']);
        assert.equal(await model.inputValue(), '');
        await model.selectOption('laya');
        await section.getByRole('status').filter({ hasText: 'The decision model changes when you save.' }).waitFor({ timeout: 2000 });
        assert.equal(state.values.has('decision:configuration'), false, 'nothing is saved by picking');
        await shot(page, '1666-decision-model', width, theme, model);
        await section.getByRole('button', { name: 'Save decision service' }).click();
        await section.getByRole('status').filter({ hasText: 'Saved.' }).waitFor({ timeout: 5000 });
        assert.equal(JSON.parse(state.values.get('decision:configuration')).model, 'laya');
        assert.deepEqual(state.audits.at(-1).slice(0, 3), ['decision.configure', 'qa-admin', { url: 'http://kev:11435', timeoutMs: 1500, model: 'laya' }]);
        overview = await overviewOf(page, origin);
        const row = overview.locator('[data-service="decision"]');
        assert.equal((await row.locator('.mm-assign-model').textContent()).trim(), 'laya');
        assert.equal((await row.locator('.mm-assign-control').textContent()).trim(), 'Model and address set in Settings, Models and routing, Decision service setup.');
        await shot(page, '1666-decision-row', width, theme, row);
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); }
  }

  // Members: read-only rows, and no admin endpoint is called, also from a deep link.
  for (const [width, height, theme] of [[2000, 1250, 'light'], [390, 844, 'dark']]) {
    const tag = `member ${width} px ${theme}`;
    const state = await createState({ rerank: true, member: true });
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      const overview = await overviewOf(page, origin);
      await check(`${tag}: no reranker switch, the Creative role is read-only, and no admin endpoint is called`, async () => {
        const reranker = overview.locator('[data-service="reranker"]');
        await reranker.waitFor({ timeout: 3000 });
        assert.equal(await reranker.getByRole('switch').count(), 0);
        assert.equal(await reranker.getByRole('combobox').count(), 0);
        assert.equal(await overview.locator('[data-role="creative"]').getByRole('combobox').count(), 0);
        await shot(page, '1665-member-overview', width, theme, reranker);
      });
      await check(`${tag}: a deep link to Settings → Models shows no Decision service setup and never calls its admin API`, async () => {
        await page.goto(`${origin}/settings/models`);
        await page.waitForTimeout(1500);
        assert.equal(await page.getByRole('region', { name: 'Decision service setup' }).count(), 0);
        assert.deepEqual(state.calls.filter(([, p]) => p.startsWith('/api/admin/decision-settings') || p === '/api/models/reranker'), []);
        // And the server refuses the member on its own (real route).
        assert.equal((await state.handle('GET', '/api/models/reranker')).status, 403);
        assert.equal((await state.handle('PUT', '/api/models/reranker', { enabled: false })).status, 403);
        assert.equal((await state.handle('PUT', '/api/admin/decision-settings', { url: 'http://kev:11435', timeoutMs: 1500, model: 'laya' })).status, 403);
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); }
  }
});
