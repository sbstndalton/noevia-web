'use strict';
// sbstndalton/noevia#2397: Models → What each service uses. A deployment that enables reranking in its environment but has no
// reranker model reports {state:'off', enabled:true, source:'deployment', model:null}. The row showed the switch ON beside an
// "Off" pill and "No reranker is available on this server". The switch now shows what is in effect (off, and disabled while
// there is nothing to switch on); the deployment-source hint stays. A reranker that answers keeps its switch on.
// Fails on a build of main, passes with the change. 375 and 768 px, light and dark.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run, mockModelsApi } = require('./ui-batch-harness.cjs');
const { openModelsPage, openModelsTab } = require('./nav.cjs');

const row = (extra) => ({ id: 'reranker', model: null, state: 'off', canChange: true, enabled: true, source: 'deployment', choice: null, choices: [], ...extra });
const services = (reranker) => ({ admin: true, services: [
  { id: 'embedding', model: 'Synthetic-Embed-Q8', state: 'active', canChange: false }, reranker,
  { id: 'ocr', model: null, state: 'active', canChange: false }, { id: 'documents', model: null, state: 'active', canChange: false }] });

async function open(browser, origin, view, reranker, probe) {
  const page = await themedPage(browser, view);
  await mockModelsApi(page, { extra: (p, req, json) => {
    if (p === '/api/models/assignments') return json(services(reranker));
    if (p === '/api/models/machines') return json({ machines: [{ id: 'local', builtIn: true, name: null, address: null, services: ['embedding', 'reranker', 'ocr', 'documents'] }], services: [], health: { services: { reranker: { state: probe } }, machines: { local: 'up' } } });
  } });
  const root = await openModelsPage(page, origin, { direct: true });
  await openModelsTab(root, 'Your models');
  const rowEl = root.getByRole('region', { name: 'What each service uses' }).locator('[data-service="reranker"]');
  await rowEl.waitFor({ timeout: 15000 });
  return { page, rowEl };
}

run('reranker-switch-2397', Number(process.env.QA_PORT || 32397), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: no reranker available, so the switch is off and agrees with the Off pill`, async () => {
      const { page, rowEl } = await open(browser, origin, view, row(), 'unknown');
      try {
        await rowEl.getByText('Off', { exact: true }).waitFor({ timeout: 10000 });
        const toggle = rowEl.getByRole('switch');
        assert.equal(await toggle.isChecked(), false, 'the switch reads off');
        assert.equal(await toggle.isDisabled(), true, 'nothing to switch on');
        await rowEl.getByText('No reranker is available on this server.').waitFor();
        await rowEl.getByText('From the server configuration.').waitFor();
        await rowEl.scrollIntoViewIfNeeded();
        await shot(page, `reranker-none-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
  await check('a reranker that answers keeps its switch on and usable', async () => {
    const { page, rowEl } = await open(browser, origin, VIEWS[2], row({ model: 'synthetic-reranker-base', state: 'active', choice: 'tei:synthetic-reranker-base', choices: [{ id: 'tei:synthetic-reranker-base', backend: 'tei', model: 'synthetic-reranker-base' }] }), 'up');
    try {
      await rowEl.getByText('Running', { exact: true }).waitFor({ timeout: 10000 });
      const toggle = rowEl.getByRole('switch');
      assert.equal(await toggle.isChecked(), true);
      assert.equal(await toggle.isDisabled(), false);
    } finally { await page.close(); }
  });
});
