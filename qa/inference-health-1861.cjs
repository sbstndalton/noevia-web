'use strict';
// #1861: Settings → Inference machines. Kev (OpenAI-style) has no /health: the probe falls back to /v1/models with the
// decision key and reads Healthy. When even that fails, the reason is plain ("Not found (HTTP 404)") and the "This machine"
// roll-up names the failing service ("Error · Decisions: Not found (HTTP 404)"). /api/models/machines is noevia-core's REAL registry, route and probe over synthetic fetches.
//   PLAYWRIGHT_MODULE=<playwright> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/inference-health-1856.cjs
// Fails on a build without the change ("Error"/"Answering"), passes with it. 2000 and 390 px, light and dark.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, CORE, EMBED } = require('./models-state-fixture.cjs');
const core = (file) => require(path.join(CORE, file));

function backend(mode) {
  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const active = { baseUrl: 'http://embed.invalid:8080', model: EMBED, profile: 'embeddinggemma-2' };
  const machines = core('inference-machines.cjs').createInferenceMachines({ store, audit: () => {}, embeddingActive: () => active, localEmbeddingUrl: () => 'http://embed.invalid:8080', log: () => {} });
  const decision = core('decision-settings.cjs').createDecisionSettings({ store, env: { COWORK_DECISION_URL: 'http://kev:11435', COWORK_DECISION_MODEL: 'kev-0.8b', COWORK_DECISION_API_KEY: 'syn-key' }, machineUrl: () => machines.urlFor('decision') });
  const reply = (status) => ({ ok: status < 300, status, body: { cancel: async () => {} } });
  const calls = [];
  const fetchImpl = async (url, opts) => {
    // Kev: no /health (404); /v1/models answers 200 only with the decision key (#1861).
    if (url.startsWith('http://kev:11435')) { calls.push(url); return new URL(url).pathname === '/v1/models' && mode.kev === 'ok' && opts?.headers?.Authorization === 'Bearer syn-key' ? reply(200) : reply(404); }
    return reply(200);
  };
  const health = core('machine-health.cjs').createMachineHealth({ fetchImpl, decisionFetchImpl: fetchImpl, ttlMs: 0 });
  const routes = core('routes/inference-machines.cjs').createInferenceMachineRoutes({
    json: (res, status, body) => { res.out = { status, body }; return true; }, readJson: async (req) => req.body, machines, health,
    effective: { decision: () => decision.get().url, embedding: () => null, reranker: () => null },
    authHeaders: { decision: (url) => { const b = decision.backend(); return b?.baseUrl && new URL(b.baseUrl).origin === new URL(url).origin ? b.healthHeaders : null; } },
    engine: () => ({ url: 'http://loader.invalid:8080', path: '/api/v1/models', headers: null }),
  });
  const user = { id: 'qa-admin', role: 'admin' };
  return { calls, async handle(method, url, body) { const res = { setHeader() {} }; await routes({ method, body }, res, { path: url.pathname, authn: { user }, url }); return res.out; } };
}


run('inference-health-1861', Number(process.env.QA_PORT || 31861), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState();
    const mode = { kev: 'ok' };
    const api = backend(mode);
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      await page.route(/\/api\/models\/machines(\?.*)?$/, async (route) => {
        const req = route.request(), url = new URL(req.url());
        const out = await api.handle(req.method(), url, undefined);
        return route.fulfill({ status: out.status, json: out.body });
      });
      const settings = () => page.getByRole('dialog', { name: 'Settings' });
      const pill = (sel) => page.locator(sel);
      await check(`${tag}: Kev with no /health but /v1/models 200 reads Healthy; This machine is Healthy`, async () => {
        await page.goto(`${origin}/settings/machines`);
        await settings().locator('.settings-title h1', { hasText: 'Inference machines' }).waitFor({ timeout: 15000 });
        const decision = pill('.machines-assign[data-service="decision"] .mm-state');
        await decision.waitFor({ timeout: 10000 });
        await page.waitForFunction(() => /Healthy/.test(document.querySelector('.machines-assign[data-service="decision"] .mm-state')?.textContent || ''), null, { timeout: 10000 });
        assert.equal((await decision.innerText()).trim(), 'Healthy');
        await page.waitForFunction(() => (document.querySelector('.machines-row[data-machine="local"] .mm-state')?.textContent || '').trim() === 'Healthy', null, { timeout: 10000 });
        assert.ok(api.calls.some((u) => u.endsWith('/health')) && api.calls.some((u) => u.endsWith('/v1/models')), api.calls.join(','));
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1861-kev-healthy-${width}-${theme}.png`) });
      });
      await check(`${tag}: a missing path reads "Not found (HTTP 404)" and This machine names the failing service`, async () => {
        mode.kev = 'gone';
        await page.getByRole('button', { name: 'Check now' }).click();
        await page.waitForFunction(() => /Not found/.test(document.querySelector('.machines-assign[data-service="decision"] .mm-state')?.textContent || ''), null, { timeout: 10000 });
        assert.equal((await pill('.machines-assign[data-service="decision"] .mm-state').innerText()).trim(), 'Error · Not found (HTTP 404)');
        const local = pill('.machines-row[data-machine="local"] .mm-state');
        await page.waitForFunction(() => /Decisions/.test(document.querySelector('.machines-row[data-machine="local"] .mm-state')?.textContent || ''), null, { timeout: 10000 });
        assert.equal((await local.innerText()).trim(), 'Error · Decisions (Laya/Kev): Not found (HTTP 404)');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1861-rollup-names-service-${width}-${theme}.png`) });
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); }
  }
});
