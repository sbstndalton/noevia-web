'use strict';
// #1841 / #1844: Settings → Inference machines also lists the sensitivity check's own decision service, OCR and
// Docling, each assignable to a machine like the decision service, each with its health pill. With nothing
// assigned nothing changes: the sensitivity check says it is shared with Decisions, and OCR and Docling stay on
// this machine.
//
// 2000 and 390 px, light and dark. Offline: the app is built from this checkout; /api/models/machines is
// noevia-core's REAL registry, route, decision settings and document-workers over an in-memory store
// (models-state-fixture.cjs), synthetic addresses only (IP literals, no DNS), a stubbed health probe that
// answers nobody.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/inference-machines-1841.cjs
// Fails on a build without the change (no Sensitivity check, OCR or Documents row to assign), passes with it.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, CORE } = require('./models-state-fixture.cjs');

const core = (file) => require(path.join(CORE, file));
const hasCore = fs.existsSync(path.join(CORE, 'document-workers.cjs'));

/** Core's machines route over the real code, the live shape except that the sensitivity check is shared (no URL of its own). */
function backend() {
  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const machines = core('inference-machines.cjs').createInferenceMachines({ store, embeddingActive: () => null, localEmbeddingUrl: () => null, log: () => {} });
  const env = { COWORK_DECISION_URL: 'http://kev:11435', COWORK_DECISION_MODEL: 'kev-0.8b' };
  const decision = core('decision-settings.cjs').createDecisionSettings({ store, env, machineUrl: () => machines.urlFor('decision'), sensitivityMachineUrl: () => machines.urlFor('sensitivity') });
  if (hasCore) core('document-workers.cjs').useMachines((kind) => machines.urlFor(kind));
  const refuse = async () => { throw Object.assign(Error('refused'), { code: 'ECONNREFUSED' }); };
  const health = core('machine-health.cjs').createMachineHealth({ fetchImpl: refuse, decisionFetchImpl: refuse });
  const routes = core('routes/inference-machines.cjs').createInferenceMachineRoutes({
    json: (res, status, body) => { res.out = { status, body }; return true; }, readJson: async (req) => req.body, machines, health,
    effective: { decision: () => decision.get().url, sensitivity: () => machines.urlFor('sensitivity'), ocr: () => machines.urlFor('ocr') || 'http://ocr:8030',
      documents: () => machines.urlFor('documents'), embedding: () => null, reranker: () => null },
  });
  const audits = [];
  return { machines, decision,
    async handle(method, url, body) {
      const res = { setHeader() {} };
      await routes({ method, body }, res, { path: url.pathname, authn: { user: { id: 'qa-admin', role: 'admin' } }, url });
      return res.out;
    } };
}

const service = (page, id) => page.locator(`.machines-assign[data-service="${id}"]`);

run('inference-machines-1841', Number(process.env.QA_PORT || 31841), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState();
    const b = backend();
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      await page.route(/\/api\/models\/machines(\?.*)?$/, async (route) => {
        const req = route.request(), url = new URL(req.url());
        let body; try { body = req.postDataJSON() ?? undefined; } catch { body = undefined; }
        const out = hasCore ? await b.handle(req.method(), url, body) : { status: 404, body: { error: 'Not found' } };
        return route.fulfill({ status: out.status, json: out.body });
      });

      await check(`${tag}: the sensitivity check, OCR and Documents are listed on this machine; the sensitivity check is shared with Decisions`, async () => {
        await page.goto(`${origin}/settings/machines`);
        await page.locator('.settings-title h1', { hasText: 'Inference machines' }).waitFor({ timeout: 15000 });
        for (const id of ['sensitivity', 'ocr', 'documents']) {
          await service(page, id).waitFor({ timeout: 10000 });
          assert.equal((await service(page, id).locator('select').first().locator('option:checked').innerText()).trim(), 'This machine', id);
        }
        assert.match(await service(page, 'sensitivity').innerText(), /Shared with Decisions/);
        assert.doesNotMatch(await service(page, 'ocr').innerText(), /Set by the deployment/);
        if (SHOTS) { await service(page, 'sensitivity').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1841-default-${width}-${theme}.png`) }); }
      });

      await check(`${tag}: each moves to a machine at once, and the health pill is on its row`, async () => {
        const form = page.getByRole('form', { name: 'Add a machine' });
        await form.getByLabel('Name').fill('QA Pi 5');
        await form.getByLabel('Address').fill('192.168.1.50');
        await form.getByRole('button', { name: 'Add machine' }).click();
        await page.locator('.machines-row', { has: page.locator('.model-name', { hasText: 'QA Pi 5' }) }).waitFor({ timeout: 10000 });
        for (const [id, label, port] of [['sensitivity', 'Sensitivity check (Laya)', '8040'], ['ocr', 'OCR (scanned pages)', '8030'], ['documents', 'Documents (Docling)', '8031']]) {
          const r = service(page, id);
          await r.getByLabel(`Machine for ${label}`).selectOption({ label: 'QA Pi 5' });
          await r.getByLabel(`Port for ${label}`).fill(port);
          await r.getByRole('button', { name: 'Apply' }).click();
          await page.getByRole('status').filter({ hasText: 'Saved. The service uses its new machine now.' }).waitFor({ timeout: 10000 });
          assert.equal(b.machines.urlFor(id), `http://192.168.1.50:${port}`);
          await r.locator('.machines-unreachable').waitFor({ timeout: 10000 });
        }
        assert.doesNotMatch(await service(page, 'sensitivity').innerText(), /Shared with Decisions/);
        assert.equal(b.machines.urlFor('decision'), null, 'the decision service did not move');
        const runs = await page.locator('.machines-row', { has: page.locator('.model-name', { hasText: 'QA Pi 5' }) }).innerText();
        assert.match(runs, /Sensitivity check \(Laya\), OCR \(scanned pages\), Documents \(Docling\)/);
        if (SHOTS) { await service(page, 'sensitivity').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1841-assigned-${width}-${theme}.png`) }); }
      });

      await check(`${tag}: back on this machine, the sensitivity check is shared again`, async () => {
        const r = service(page, 'sensitivity');
        await r.getByLabel('Machine for Sensitivity check (Laya)').selectOption({ label: 'This machine' });
        await r.getByRole('button', { name: 'Apply' }).click();
        await r.getByText('Shared with Decisions').waitFor({ timeout: 10000 });
        assert.equal(b.machines.urlFor('sensitivity'), null);
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); if (hasCore) core('document-workers.cjs').useMachines(); }
  }
});
