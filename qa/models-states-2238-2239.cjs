'use strict';
// Models page, as an administrator, with the model manager and every service unreachable.
//  #2239: Installed read "Loading models…" for ever after GET /api/models/installed answered 502, with the error beneath it.
//         The loading line now goes, the error stays and a "Try again" retries (and the list appears when the retry succeeds).
//  #2238: "What each service uses" said a blue "Running" for Embedding, OCR and Document reading although they were unreachable,
//         because GET /api/models/assignments answers 'active' for any service with an address set up (it does not probe). The row now
//         asks the inference-machines probe (GET /api/models/machines?health=1, administrators) and shows Unreachable / Error / Running
//         from the answer; with no answer (a member, or the probe failing) it says "Configured". The reranker's row no longer says "Off"
//         beside a switch that is on.
// Synthetic endpoints in the real shapes (assignments from model-assignments.cjs, machines health from machine-health.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/models-states-2238-2239.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { openModelsPage, openModelsTab } = require('./nav.cjs');
const { run, openPage, shot, ADMIN, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const EMBED = 'embeddinggemma-2-Q8_0';
const assignments = (admin) => ({ admin, available: true, services: [
  { id: 'embedding', model: EMBED, state: 'active', canChange: admin, ...(admin ? { options: [], baseUrl: 'http://embed.invalid:8080' } : {}) },
  { id: 'reranker', model: null, state: 'off', canChange: admin, ...(admin ? { options: [], enabled: true, choice: 'tei:gte-multilingual-reranker-base', source: 'deployment', choices: [{ id: 'tei:gte-multilingual-reranker-base', backend: 'tei', model: 'gte-multilingual-reranker-base' }] } : {}) },
  { id: 'decision', model: 'kev-0.8b', state: 'active', canChange: false, ...(admin ? { source: 'deployment', models: ['kev-0.8b'], deploymentModel: 'kev-0.8b' } : {}) },
  { id: 'sensitivity', model: 'laya', state: 'active', canChange: false, shared: false },
  { id: 'ocr', model: null, state: 'active', canChange: false },
  { id: 'documents', model: null, state: 'active', canChange: false },
] });
const unreachable = { services: { embedding: { state: 'unreachable', reason: 'refused' }, reranker: { state: 'unreachable', reason: 'refused' }, ocr: { state: 'unreachable', reason: 'refused' }, documents: { state: 'unreachable', reason: 'refused' } }, machines: { local: 'unreachable' } };
const answering = { services: { embedding: { state: 'up' }, reranker: { state: 'up' }, ocr: { state: 'up' }, documents: { state: 'up' } }, machines: { local: 'up' } };
const machines = (health) => ({ machines: [{ id: 'local', builtIn: true, name: null, address: null, services: ['embedding', 'reranker', 'ocr', 'documents'] }], services: [], ...(health ? { health } : {}) });

/** The Models page's own endpoints. `installed()` answers GET /api/models/installed; `probe` is the machines answer (or a status). */
const mock = ({ admin = true, installed, probe }) => async (page) => {
  await page.route('**/api/models/installed', (r) => { const a = installed(); return r.fulfill({ status: a.status, json: a.body }); });
  await page.route('**/api/models/assignments', (r) => r.fulfill({ json: assignments(admin) }));
  await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin, presets: true, download: true, runtimeOptions: false, modelManagement: admin } }));
  await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: false, roles: null } }));
  await page.route('**/api/model-manager/**', (r) => {
    const path = new URL(r.request().url()).pathname.slice('/api/model-manager/'.length);
    if (path === 'models') return r.fulfill({ json: { models: [], unregistered: [], revision: 'r1' } });
    if (path === 'overview') return r.fulfill({ json: { modelsDir: { disk: { total: 1e12, free: 5e11, usedPct: 50, totalH: '1 TB', freeH: '500 GB' } }, revision: 'r1' } });
    if (path === 'models/updates') return r.fulfill({ json: { status: {} } });
    return r.fulfill({ json: {} });
  });
  await page.route(/\/api\/models\/machines(\?.*)?$/, (r) => (probe.status ? r.fulfill({ status: probe.status, json: { error: 'Administrator required' } }) : r.fulfill({ json: machines(probe.health) })));
};
const pills = async (root) => {
  const out = {};
  for (const id of ['embedding', 'reranker', 'ocr', 'documents', 'decision', 'sensitivity']) out[id] = (await root.locator(`.mm-assign-row[data-service="${id}"] .mm-state`).textContent()).trim();
  return out;
};

run('models-states-2238-2239', Number(process.env.QA_PORT || 32238), async (check, browser, origin) => {
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const theme of ['light', 'dark']) {
      const tag = `${view.name} ${theme}`;
      await check(`${tag}: #2239 a failed list drops "Loading models…", keeps the error and Try again loads the list`, async () => {
        let fail = true;
        const { page, context, errors } = await openPage(browser, view, theme, { mock: mock({ installed: () => (fail ? { status: 502, body: { error: 'Could not list installed models.' } } : { status: 200, body: [{ name: 'Qwen3.5-4B', labels: [], loaded: true }] }), probe: { health: unreachable } }) });
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Your models');
        const library = root.locator('.mm-tab').filter({ has: page.locator('.mm-library-bar') });
        await library.locator('.modal-err').waitFor({ timeout: 15000 });
        assert.match(await library.locator('.modal-err').textContent(), /Could not list installed models\./);
        assert.equal(await library.getByText('Loading models…').count(), 0, '"Loading models…" is still shown after the list failed');
        await shot(page, `2239-installed-failed-${view.name}-${theme}`);
        fail = false;
        await library.getByRole('button', { name: 'Try again' }).click();
        await library.getByText(/1 of 1 model/).waitFor({ timeout: 15000 });
        assert.equal(await library.locator('.modal-err').count(), 0, 'the error stays after a successful retry');
        assert.equal(await library.getByText('Loading models…').count(), 0);
        assert.deepEqual(errors, []);
        await context.close();
      });
      await check(`${tag}: #2238 unreachable services read Unreachable, never Running; Decision and Sensitivity stay Configured`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { mock: mock({ installed: () => ({ status: 200, body: [] }), probe: { health: unreachable } }) });
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Your models');
        const card = root.getByRole('region', { name: 'What each service uses' });
        await card.locator('.mm-assign-list').waitFor({ timeout: 15000 });
        await page.waitForFunction(() => document.querySelector('.mm-assign-row[data-service="ocr"] .mm-state')?.textContent.trim() === 'Unreachable', null, { timeout: 15000 }).catch(() => undefined);
        const p = await pills(card);
        assert.deepEqual(p, { embedding: 'Unreachable', reranker: 'Unreachable', ocr: 'Unreachable', documents: 'Unreachable', decision: 'Configured', sensitivity: 'Configured' });
        await shot(page, `2238-unreachable-${view.name}-${theme}`, { fullPage: true });
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
  await check('1440 light: #2238 services that answer read Running', async () => {
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: mock({ installed: () => ({ status: 200, body: [] }), probe: { health: answering } }) });
    const root = await openModelsPage(page, origin, { direct: true });
    await openModelsTab(root, 'Your models');
    const card = root.getByRole('region', { name: 'What each service uses' });
    await card.locator('.mm-assign-row[data-service="ocr"] .mm-state', { hasText: 'Running' }).waitFor({ timeout: 15000 });
    const p = await pills(card);
    assert.deepEqual([p.embedding, p.reranker, p.ocr, p.documents], ['Running', 'Running', 'Running', 'Running']);
    await shot(page, '2238-running-1440-light', { fullPage: true });
    await context.close();
  });
  await check('1440 light: #2238 with no probe answer (a member, or the probe failing) a set-up service reads Configured, not Running', async () => {
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { user: { ...ADMIN, role: 'member' }, mock: mock({ admin: false, installed: () => ({ status: 200, body: [] }), probe: { status: 403 } }) });
    const root = await openModelsPage(page, origin, { direct: true });
    const card = root.getByRole('region', { name: 'What each service uses' });
    await card.locator('.mm-assign-list').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const p = await pills(card);
    assert.deepEqual([p.embedding, p.ocr, p.documents], ['Configured', 'Configured', 'Configured']);
    await context.close();
  });
});
