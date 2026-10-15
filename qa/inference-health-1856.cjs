'use strict';
// #1856: Settings → Inference machines health. Kev answers 401 to an unauthenticated /health: that reads as
// "Healthy · needs sign-in", not "Error". "This machine" probes the engine the app really uses; when that
// refuses, the pill says why ("Unreachable · Connection refused"), and when it answers it reads "Healthy"
// (not "Answering"). /api/models/machines is noevia-core's REAL registry, route and probe over synthetic fetches.
//   PLAYWRIGHT_MODULE=<playwright> QA_DIST=<dist> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] node qa/inference-health-1856.cjs
// Fails on a build without the change ("Error"/"Answering"), passes with it. 2000 and 390 px, light and dark.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, CORE, EMBED } = require('./models-state-fixture.cjs');
const core = (file) => require(path.join(CORE, file));

function backend(engineMode) {
  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const active = { baseUrl: 'http://embed.invalid:8080', model: EMBED, profile: 'embeddinggemma-2' };
  const machines = core('inference-machines.cjs').createInferenceMachines({ store, audit: () => {}, embeddingActive: () => active, localEmbeddingUrl: () => 'http://embed.invalid:8080', log: () => {} });
  const decision = core('decision-settings.cjs').createDecisionSettings({ store, env: { COWORK_DECISION_URL: 'http://kev:11435', COWORK_DECISION_MODEL: 'kev-0.8b' }, machineUrl: () => machines.urlFor('decision') });
  const reply = (status) => ({ ok: status < 300, status, body: { cancel: async () => {} } });
  const fetchImpl = async (url) => {
    if (url.startsWith('http://kev:11435')) return reply(401); // needs its key; none is configured here
    if (url.startsWith('http://loader.invalid')) { if (engineMode.value === 'refused') throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); return reply(200); }
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
  return { async handle(method, url, body) { const res = { setHeader() {} }; await routes({ method, body }, res, { path: url.pathname, authn: { user }, url }); return res.out; } };
}

run('inference-health-1856', Number(process.env.QA_PORT || 31856), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState();
    const engineMode = { value: 'refused' };
    const api = backend(engineMode);
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      await page.route(/\/api\/models\/machines(\?.*)?$/, async (route) => {
        const req = route.request(), url = new URL(req.url());
        let body; try { body = req.postDataJSON() ?? undefined; } catch { body = undefined; }
        const out = await api.handle(req.method(), url, body);
        return route.fulfill({ status: out.status, json: out.body });
      });
      const settings = () => page.getByRole('dialog', { name: 'Settings' });
      await check(`${tag}: a 401 from Kev is Healthy (needs sign-in); a refusing engine says why on This machine`, async () => {
        await page.goto(`${origin}/settings/machines`);
        await settings().locator('.settings-title h1', { hasText: 'Inference machines' }).waitFor({ timeout: 15000 });
        const decision = page.locator('.machines-assign[data-service="decision"] .mm-state');
        await decision.waitFor({ timeout: 10000 });
        assert.equal((await decision.innerText()).trim(), 'Healthy · needs sign-in');
        const local = page.locator('.machines-row[data-machine="local"] .mm-state');
        await page.waitForFunction(() => /Unreachable/.test(document.querySelector('.machines-row[data-machine="local"] .mm-state')?.textContent || ''), null, { timeout: 10000 });
        assert.equal((await local.innerText()).trim(), 'Unreachable · Connection refused');
        assert.doesNotMatch(await page.locator('.inference-machines').innerText(), /\bError\b|Answering/);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1856-health-refused-${width}-${theme}.png`) });
      });
      await check(`${tag}: once the engine answers, This machine reads Healthy`, async () => {
        engineMode.value = 'up';
        await page.getByRole('button', { name: 'Check now' }).click();
        await page.waitForFunction(() => (document.querySelector('.machines-row[data-machine="local"] .mm-state')?.textContent || '').trim() === 'Healthy', null, { timeout: 10000 });
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1856-health-up-${width}-${theme}.png`) });
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); }
  }
});
