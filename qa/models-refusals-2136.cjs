'use strict';
// sbstndalton/noevia#2136, Models page follow-ups to the inference gate (#2115): (1) a load, unload or delete the server refuses
// with a known code reads in the interface language, not as the server's English; (2) the "model in use" notice goes when the
// model is no longer loaded (it went idle and was unloaded) without a reload. The force flow itself (Unload anyway / Keep) is
// covered by qa/waiting-for-model-2115.cjs and, in CI, by tests/client/models-refusals-2136.test.cjs.
// Fails on a build of main, passes with the change. Mocked model calls, synthetic model names.
const assert = require('node:assert/strict');
const { themedPage, shot, run, mockModelsApi } = require('./ui-batch-harness.cjs');
const { openModelsPage, openModelsTab } = require('./nav.cjs');

const MODEL = 'Synthetic-Fast-Q4';
const SERVER_ENGLISH = 'Server English: the queue refused this.';

async function open(browser, origin, { loaded, refuse, view = [1100, 900, 'light'] }) {
  const page = await themedPage(browser, view);
  const calls = [], state = { loaded };
  await mockModelsApi(page, {
    installed: () => [{ name: MODEL, labels: [], loaded: state.loaded, sizeGB: 4, source: 'preset', canDelete: true, status: state.loaded ? 'loaded' : 'unloaded' }],
    extra: (p, req, json) => {
      if (['/api/models/load', '/api/models/unload', '/api/models/delete'].includes(p) && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        calls.push({ path: p, body });
        return json(refuse(p, body, state), 409);
      }
    },
  });
  const root = await openModelsPage(page, origin, { direct: true });
  await openModelsTab(root, 'Your models');
  const card = root.getByRole('article', { name: MODEL });
  await card.waitFor({ timeout: 15000 });
  return { page, card, calls, state };
}

run('models-refusals-2136', Number(process.env.QA_PORT || 32136), async (check, browser, origin) => {
  await check('a refused load reads as a plain sentence, not the server\'s English', async () => {
    const { page, card } = await open(browser, origin, { loaded: false, refuse: () => ({ error: SERVER_ENGLISH, code: 'inference_queue_full' }) });
    try {
      await card.getByRole('button', { name: `Load ${MODEL}`, exact: true }).click();
      await page.getByText('The local model is busy with another request. Try again when it has finished.').first().waitFor({ timeout: 8000 });
      assert.equal(await page.getByText(SERVER_ENGLISH).count(), 0);
    } finally { await page.close(); }
  });
  await check('a load refused because the model is in use names it and says to try again', async () => {
    const { page, card } = await open(browser, origin, { loaded: false, refuse: () => ({ error: SERVER_ENGLISH, code: 'model_in_use' }) });
    try {
      await card.getByRole('button', { name: `Load ${MODEL}`, exact: true }).click();
      await page.getByText(`${MODEL} is answering a request. Try again when it is idle.`).first().waitFor({ timeout: 8000 });
      assert.equal(await page.getByText(SERVER_ENGLISH).count(), 0);
    } finally { await page.close(); }
  });
  await check('a refused delete reads as a plain sentence', async () => {
    const { page, card } = await open(browser, origin, { loaded: false, refuse: () => ({ error: SERVER_ENGLISH, code: 'engine_busy' }) });
    try {
      await card.getByRole('button', { name: `Delete ${MODEL}`, exact: true }).click();
      await card.getByRole('group', { name: `Delete ${MODEL}` }).getByRole('button', { name: /^Delete/ }).first().click();
      await page.getByText('The local model engine is busy. Try again shortly.').first().waitFor({ timeout: 8000 });
      assert.equal(await page.getByText(SERVER_ENGLISH).count(), 0);
    } finally { await page.close(); }
  });
  await check('a refusal with no known code still shows the server\'s text', async () => {
    const { page, card } = await open(browser, origin, { loaded: false, refuse: () => ({ error: 'Server English: something new.', code: 'some_future_code' }) });
    try {
      await card.getByRole('button', { name: `Load ${MODEL}`, exact: true }).click();
      await page.getByText('Server English: something new.').first().waitFor({ timeout: 8000 });
    } finally { await page.close(); }
  });
  for (const view of [[375, 812, 'light'], [1100, 900, 'dark']]) {
    await check(`${view[0]} px ${view[2]}: the "model in use" notice goes when the model is no longer loaded`, async () => {
      const { page, card, state } = await open(browser, origin, { loaded: true, view, refuse: () => ({ error: SERVER_ENGLISH, code: 'model_in_use', retryable: true, canForce: true }) });
      try {
        await card.getByRole('button', { name: `Unload ${MODEL}`, exact: true }).click();
        const notice = card.getByTestId('model-in-use');
        await notice.waitFor({ timeout: 8000 });
        await shot(page, `models-in-use-notice-${view[0]}-${view[2]}`);
        // The answer finishes and something else unloads the model: the notice must not keep offering to stop a reply that is over.
        state.loaded = false;
        await notice.waitFor({ state: 'detached', timeout: 12000 });
      } finally { await page.close(); }
    });
  }
  await check('the notice stays while the model is still loaded', async () => {
    const { page, card } = await open(browser, origin, { loaded: true, refuse: () => ({ error: SERVER_ENGLISH, code: 'model_in_use', retryable: true, canForce: true }) });
    try {
      await card.getByRole('button', { name: `Unload ${MODEL}`, exact: true }).click();
      const notice = card.getByTestId('model-in-use');
      await notice.waitFor({ timeout: 8000 });
      await page.waitForTimeout(7000);
      assert.equal(await notice.count(), 1);
    } finally { await page.close(); }
  });
});
