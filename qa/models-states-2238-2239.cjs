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

const path = require('node:path');
const EMBED = 'embeddinggemma-2-Q8_0';
// The assignments are built by noevia-core's own server/model-assignments.cjs (QA_CORE_SERVER), so the reranker row is what core really
// sends for each deployment: 'tei' = RERANK_BACKEND=tei with a model and an address (state active); 'bare' = NOEVIA_FEATURE_RAG_RERANK=true with
// no RERANK_MODEL and no address on a non-TEI backend (state off while enabled is true: retrieval then uses cosine).
const CORE = path.resolve(process.env.QA_CORE_SERVER || path.join(__dirname, '../../noevia-core/server'));
const { modelAssignments } = require(path.join(CORE, 'model-assignments.cjs'));
const RERANK_ENV = {
  tei: { NOEVIA_FEATURE_RAG_RERANK: 'true', RERANK_BACKEND: 'tei', RERANK_MODEL: 'gte-multilingual-reranker-base', RERANK_BASE_URL: 'http://rerank.invalid:8080' },
  bare: { NOEVIA_FEATURE_RAG_RERANK: 'true' },
};
const assignments = (admin, rerank = 'tei') => {
  const env = { OCR_BASE_URL: 'http://ocr.invalid:8090', DOCLING_BASE_URL: 'http://docling.invalid:8091', EMBEDDING_MODEL: EMBED, COWORK_DECISION_URL: 'http://kev:11435', COWORK_DECISION_MODEL: 'kev-0.8b', ...RERANK_ENV[rerank] };
  const on = /^(1|true|on)$/i.test(env.NOEVIA_FEATURE_RAG_RERANK);
  // rerank-settings.cjs get(): the deployment's choice is the id 'tei' for a TEI reranker, else null without a llama.cpp model.
  const switchable = { enabled: on, choice: env.RERANK_BACKEND === 'tei' ? 'tei' : null, source: 'deployment', options: env.RERANK_BACKEND === 'tei' ? [{ id: 'tei', backend: 'tei', model: env.RERANK_MODEL }] : [] };
  const v = modelAssignments({ installed: [{ name: EMBED, labels: ['embedding'], loaded: true }], env, admin, embedding: { active: { model: EMBED, profile: 'embeddinggemma-2' } },
    rerank: { effectiveEnv: () => env, get: () => switchable }, decision: { decision: { model: 'kev-0.8b', state: 'active', source: 'deployment' }, sensitivity: { model: 'laya', state: 'active', shared: false } } });
  return { ...v, available: true };
};
const up = { state: 'up' }, refused = { state: 'unreachable', reason: 'refused' };
const health = (embedding, reranker, ocr, documents) => ({ services: { embedding, reranker, ocr, documents }, machines: { local: 'up' } });
const unreachable = health(refused, refused, refused, refused);
const answering = health(up, up, up, up);
const machines = (h) => ({ machines: [{ id: 'local', builtIn: true, name: null, address: null, services: ['embedding', 'reranker', 'ocr', 'documents'] }], services: [], ...(h ? { health: h } : {}) });

/** The Models page's own endpoints. `installed()` answers GET /api/models/installed; `probe` is { health } or { status }; `counter.machines` counts probe requests. */
const mock = ({ admin = true, rerank = 'tei', installed, probe, counter = { machines: 0 } }) => async (page) => {
  await page.route('**/api/models/installed', (r) => { const a = installed(); return r.fulfill({ status: a.status, json: a.body }); });
  await page.route('**/api/models/assignments', (r) => r.fulfill({ json: assignments(admin, rerank) }));
  await page.route('**/api/models/capabilities', (r) => r.fulfill({ json: { kind: 'llamacpp', admin, presets: true, download: true, runtimeOptions: false, modelManagement: admin } }));
  await page.route('**/api/auto-roles', (r) => r.fulfill({ json: { configured: false, roles: null } }));
  await page.route('**/api/model-manager/**', (r) => {
    const sub = new URL(r.request().url()).pathname.slice('/api/model-manager/'.length);
    if (sub === 'models') return r.fulfill({ json: { models: [], unregistered: [], revision: 'r1' } });
    if (sub === 'overview') return r.fulfill({ json: { modelsDir: { disk: { total: 1e12, free: 5e11, usedPct: 50, totalH: '1 TB', freeH: '500 GB' } }, revision: 'r1' } });
    if (sub === 'models/updates') return r.fulfill({ json: { status: {} } });
    return r.fulfill({ json: {} });
  });
  await page.route(/\/api\/models\/machines(\?.*)?$/, (r) => { counter.machines += 1; return probe.status ? r.fulfill({ status: probe.status, json: { error: probe.status === 403 ? 'Administrator required' : 'Server error' } }) : r.fulfill({ json: machines(probe.health) }); });
};
const pills = async (root) => {
  const out = {};
  for (const id of ['embedding', 'reranker', 'ocr', 'documents', 'decision', 'sensitivity']) out[id] = (await root.locator(`.mm-assign-row[data-service="${id}"] .mm-state`).textContent()).trim();
  return out;
};
const openCard = async (page, origin) => {
  const root = await openModelsPage(page, origin, { direct: true });
  await openModelsTab(root, 'Your models');
  const card = root.getByRole('region', { name: 'What each service uses' });
  await card.locator('.mm-assign-list').waitFor({ timeout: 15000 });
  return { root, card };
};

run('models-states-2238-2239', Number(process.env.QA_PORT || 32238), async (check, browser, origin) => {
  // The two reranker fixtures are what core sends: check them, so a core that changes them fails here rather than passing a stale mock.
  assert.deepEqual(assignments(true, 'tei').services.find((x) => x.id === 'reranker').state, 'active');
  const bare = assignments(true, 'bare').services.find((x) => x.id === 'reranker');
  assert.deepEqual([bare.state, bare.enabled, bare.model], ['off', true, null], 'core: switched on, no model, no address reads off');
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const theme of ['light', 'dark']) {
      const tag = `${view.name} ${theme}`;
      await check(`${tag}: #2239 a failed list drops "Loading models…", keeps the error; Try again keeps focus and then loads the list`, async () => {
        let mode = 'fail', release = null;
        const { page, context, errors } = await openPage(browser, view, theme, { mock: async (pg) => {
          await mock({ installed: () => ({ status: 200, body: [] }), probe: { health: unreachable } })(pg);
          await pg.route('**/api/models/installed', async (r) => {
            if (mode === 'hold') await new Promise((res) => { release = res; });
            return mode === 'ok' ? r.fulfill({ json: [{ name: 'Qwen3.5-4B', labels: [], loaded: true }] }) : r.fulfill({ status: 502, json: { error: 'Could not list installed models.' } });
          });
        } });
        const root = await openModelsPage(page, origin, { direct: true });
        await openModelsTab(root, 'Your models');
        const library = root.locator('.mm-tab').filter({ has: page.locator('.mm-library-bar') });
        await library.locator('.modal-err').waitFor({ timeout: 15000 });
        assert.match(await library.locator('.modal-err').textContent(), /Could not list installed models\./);
        assert.equal(await library.getByText('Loading models…').count(), 0, '"Loading models…" is still shown after the list failed');
        await shot(page, `2239-installed-failed-${view.name}-${theme}`);
        // Retry while the answer is held: the button stays mounted and keeps focus.
        const retry = library.getByRole('button', { name: 'Try again' });
        mode = 'hold';
        await retry.focus();
        await retry.click();
        await page.waitForFunction(() => document.activeElement?.textContent === 'Try again');
        assert.equal(await retry.count(), 1, 'the button was removed during the retry');
        assert.equal(await retry.getAttribute('aria-disabled'), 'true', 'the button does not say it is busy');
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Try again', 'focus dropped off the button during the retry');
        // The retry fails again: still the same button, still focused.
        mode = 'fail'; release();
        await page.waitForFunction(() => document.querySelector('.mm-tab button[aria-disabled="true"]') === null);
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Try again', 'focus dropped after a second failure');
        // And a retry that succeeds loads the list.
        mode = 'ok';
        await retry.click();
        await library.getByText(/1 of 1 model/).waitFor({ timeout: 15000 });
        assert.equal(await library.locator('.modal-err').count(), 0, 'the error stays after a successful retry');
        assert.equal(await library.getByText('Loading models…').count(), 0);
        assert.deepEqual(errors, []);
        await context.close();
      });
      await check(`${tag}: #2238 unreachable services read Unreachable (a TEI reranker too); one polite line names them`, async () => {
        const { page, context, errors } = await openPage(browser, view, theme, { mock: mock({ installed: () => ({ status: 200, body: [] }), probe: { health: unreachable } }) });
        const { card } = await openCard(page, origin);
        await card.locator('.mm-assign-row[data-service="ocr"] .mm-state', { hasText: 'Unreachable' }).waitFor({ timeout: 15000 });
        assert.deepEqual(await pills(card), { embedding: 'Unreachable', reranker: 'Unreachable', ocr: 'Unreachable', documents: 'Unreachable', decision: 'Configured', sensitivity: 'Configured' });
        const live = card.locator('div[aria-live="polite"]').first();
        assert.match(await live.textContent(), /^Not answering: .*Embedding.*Reranker.*OCR.*Document reading/);
        assert.equal(await card.locator('[role="alert"]').count(), 0, 'the summary is polite, not an alert');
        await shot(page, `2238-unreachable-${view.name}-${theme}`, { fullPage: true });
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
  await check('1440 light: #2238 services that answer read Running, and nothing is announced', async () => {
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: mock({ installed: () => ({ status: 200, body: [] }), probe: { health: answering } }) });
    const { card } = await openCard(page, origin);
    await card.locator('.mm-assign-row[data-service="ocr"] .mm-state', { hasText: 'Running' }).waitFor({ timeout: 15000 });
    const p = await pills(card);
    assert.deepEqual([p.embedding, p.reranker, p.ocr, p.documents], ['Running', 'Running', 'Running', 'Running']);
    assert.equal((await card.locator('div[aria-live="polite"]').first().textContent()).trim(), '', 'something is announced although everything answers');
    await shot(page, '2238-running-1440-light', { fullPage: true });
    await context.close();
  });
  await check('1440 light: #2238 reranker switched on with no model and no address (core: off, enabled) reads Off once the probe answered unknown, Configured before', async () => {
    let answer = null;
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { mock: async (pg) => {
      await mock({ rerank: 'bare', installed: () => ({ status: 200, body: [] }), probe: { health: health(up, { state: 'unknown' }, up, up) } })(pg);
      await pg.route(/\/api\/models\/machines(\?.*)?$/, async (r) => { await new Promise((res) => { answer = res; }); return r.fulfill({ json: machines(health(up, { state: 'unknown' }, up, up)) }); });
    } });
    const { card } = await openCard(page, origin);
    await page.waitForFunction(() => document.querySelector('.mm-assign-row[data-service="reranker"] .mm-state')?.textContent.trim() === 'Configured');
    await page.waitForTimeout(100); answer();
    await card.locator('.mm-assign-row[data-service="reranker"] .mm-state', { hasText: 'Off' }).waitFor({ timeout: 15000 });
    assert.equal(await card.locator('.mm-assign-row[data-service="embedding"] .mm-state').textContent(), 'Running');
    await shot(page, '2238-reranker-bare-1440-light', { fullPage: true });
    await context.close();
  });
  await check('1440 light: #2238 a member sends no probe request and reads Configured', async () => {
    const counter = { machines: 0 };
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { user: { ...ADMIN, role: 'member' }, mock: mock({ admin: false, installed: () => ({ status: 200, body: [] }), probe: { status: 403 }, counter }) });
    const { card } = await openCard(page, origin);
    await page.waitForTimeout(800);
    const p = await pills(card);
    assert.deepEqual([p.embedding, p.ocr, p.documents], ['Configured', 'Configured', 'Configured']);
    assert.equal(counter.machines, 0, `a member asked the administrator-only probe ${counter.machines} time(s)`);
    assert.equal((await card.locator('div[aria-live="polite"]').first().textContent()).trim(), '', 'a member is told the check failed');
    await context.close();
  });
  for (const theme of ['light', 'dark']) {
    await check(`${theme}: #2238 an administrator whose probe fails (HTTP 500) reads Configured and gets one polite note saying the check failed`, async () => {
      const counter = { machines: 0 };
      const { page, context } = await openPage(browser, { options: DESKTOP }, theme, { mock: mock({ installed: () => ({ status: 200, body: [] }), probe: { status: 500 }, counter }) });
      const { card } = await openCard(page, origin);
      const note = card.locator('div[aria-live="polite"]').first();
      await note.getByText(/Could not check whether these services answer/).waitFor({ timeout: 15000 });
      assert.equal(await note.locator('p').count(), 1, 'exactly one note');
      const p = await pills(card);
      assert.deepEqual([p.embedding, p.ocr, p.documents], ['Configured', 'Configured', 'Configured']);
      assert.ok(counter.machines >= 1);
      await shot(page, `2238-probe-500-1440-${theme}`, { fullPage: true });
      await context.close();
    });
  }
});
