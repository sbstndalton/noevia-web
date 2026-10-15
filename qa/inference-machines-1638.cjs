'use strict';
// #1638: Settings → Inference machines. Default: everything on this machine. An administrator adds a machine on
// this network, a public address is refused, moving embeddings asks for the #1636 re-index first and then starts
// it through POST /api/embedding, the decision service's "not answering" state is visible, and a member never
// sees the page (no entry, a deep link never calls the admin API).
//
// 2000 and 390 px, light and dark. Offline: the app is built from this checkout; /api/models/machines is
// noevia-core's REAL registry, route and decision settings over an in-memory store (models-state-fixture.cjs),
// with synthetic addresses only (IP literals, no DNS) and a stubbed health probe (the decision service does
// not answer). POST /api/embedding is recorded and answered as a re-index that has started.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/inference-machines-1638.cjs
// Fails on a build without the change (no page, no navigation entry), passes with it.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, CORE, EMBED } = require('./models-state-fixture.cjs');

const core = (file) => require(path.join(CORE, file));
const hasCore = fs.existsSync(path.join(CORE, 'inference-machines.cjs'));

/** The machines route over core's real code, for one role. Returns null when this core has no such route. */
function machinesBackend(role) {
  if (!hasCore) return null;
  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const audits = [];
  const audit = (action, actor, detail) => audits.push({ action, actor, detail });
  const active = { baseUrl: 'http://embed.invalid:8080', model: EMBED, profile: 'embeddinggemma-2' };
  const machines = core('inference-machines.cjs').createInferenceMachines({ store, audit, embeddingActive: () => active, localEmbeddingUrl: () => 'http://embed.invalid:8080', log: () => {} });
  const env = { COWORK_DECISION_URL: 'http://kev:11435', COWORK_DECISION_MODEL: 'kev-0.8b' };
  const decision = core('decision-settings.cjs').createDecisionSettings({ store, env, machineUrl: () => machines.urlFor('decision') });
  // The decision service does not answer; nothing else is probed (embeddings on this machine's sidecar, no reranker).
  const health = core('machine-health.cjs').createMachineHealth({
    fetchImpl: async () => { throw Object.assign(Error('refused'), { code: 'ECONNREFUSED' }); },
    decisionFetchImpl: async () => { throw Object.assign(Error('refused'), { code: 'ECONNREFUSED' }); },
  });
  const routes = core('routes/inference-machines.cjs').createInferenceMachineRoutes({
    json: (res, status, body) => { res.out = { status, body }; return true; }, readJson: async (req) => req.body, machines, health,
    effective: { decision: () => decision.get().url, embedding: () => null, reranker: () => null },
  });
  const user = role === 'admin' ? { id: 'qa-admin', role: 'admin' } : { id: 'qa-member', role: 'member' };
  return {
    audits, machines,
    async handle(method, url, body) {
      const res = { setHeader() {} };
      await routes({ method, body }, res, { path: url.pathname, authn: { user }, url });
      return res.out;
    },
  };
}

/** Routes /api/models/machines and /api/embedding for `page`; everything else stays with the models fixture. */
async function wire(page, backend, record) {
  await page.route(/\/api\/models\/machines(\?.*)?$/, async (route) => {
    const req = route.request(), url = new URL(req.url());
    record.machines.push(`${req.method()} ${url.pathname}${url.search}`);
    let body; try { body = req.postDataJSON() ?? undefined; } catch { body = undefined; }
    const out = backend ? await backend.handle(req.method(), url, body) : { status: 404, body: { error: 'Not found' } };
    return route.fulfill({ status: out.status, json: out.body });
  });
  await page.route('**/api/embedding', async (route) => {
    const req = route.request();
    let body; try { body = req.postDataJSON() ?? undefined; } catch { body = undefined; }
    record.embedding.push(body);
    if (req.method() !== 'POST') return route.fulfill({ status: 200, json: { projects: {}, diary: {} } });
    if (body?.action === 'set-next') return route.fulfill({ status: 200, json: { projects: { next: body.target }, diary: { next: body.target } } });
    if (body?.action === 'switch') return route.fulfill({ status: 409, json: { projects: { error: 'The re-index is not finished yet.', code: 'notReady' }, diary: { error: 'not ready', code: 'notReady' } } });
    return route.fulfill({ status: 200, json: { projects: {}, diary: {} } });
  });
}

const row = (page, name) => page.locator('.machines-row', { has: page.locator('.model-name', { hasText: name }) });

run('inference-machines-1638', Number(process.env.QA_PORT || 31638), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState();
    const backend = machinesBackend('admin');
    const record = { machines: [], embedding: [] };
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      await wire(page, backend, record);

      await check(`${tag}: the default view has one machine, this one, running every part of noevia`, async () => {
        await page.goto(`${origin}/settings/machines`);
        const settings = page.getByRole('dialog', { name: 'Settings' });
        await settings.locator('.settings-title h1', { hasText: 'Inference machines' }).waitFor({ timeout: 15000 });
        await page.locator('.machines-row').first().waitFor({ timeout: 10000 });
        assert.equal(await page.locator('.machines-row').count(), 1, 'only this machine');
        const local = row(page, 'This machine');
        assert.match(await local.innerText(), /Fast chat, Smart chat, Code chat, Vision, Decisions \(Laya\/Kev\), Sensitivity check \(Laya\), Embeddings \(projects and Diary\), Reranker, OCR \(scanned pages\), Documents \(Docling\)/);
        for (const id of ['chatFast', 'chatSmart', 'chatCode', 'vision', 'decision', 'sensitivity', 'embedding', 'reranker', 'ocr', 'documents']) {
          const r = page.locator(`.machines-assign[data-service="${id}"]`);
          await r.waitFor();
          const select = r.locator('select').first();
          const shown = await select.count() ? await select.locator('option:checked').innerText() : await r.locator('.mm-assign-model').innerText();
          assert.equal(shown.trim(), 'This machine', id);
        }
        assert.match(await page.locator('.machines-assign[data-service="chatFast"]').innerText(), /Chat models stay on this machine for now\./);
        // The decision service does not answer: said on its row and on this machine.
        await page.locator('.machines-assign[data-service="decision"] .machines-unreachable').waitFor({ timeout: 10000 });
        assert.match(await page.locator('.machines-assign[data-service="decision"]').innerText(), /Unreachable/);
        assert.match(await local.innerText(), /Unreachable/);
        if (SHOTS) {
          await page.screenshot({ path: path.join(SHOTS, `1638-default-${width}-${theme}.png`) });
          await page.locator('.machines-assign[data-service="decision"]').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(SHOTS, `1638-default-assignments-${width}-${theme}.png`) });
        }
      });

      await check(`${tag}: an administrator adds a machine on this network`, async () => {
        const form = page.getByRole('form', { name: 'Add a machine' });
        await form.getByLabel('Name').fill('QA Pi 5');
        await form.getByLabel('Address').fill('192.168.1.50');
        await form.getByRole('button', { name: 'Add machine' }).click();
        await row(page, 'QA Pi 5').waitFor({ timeout: 10000 });
        assert.match(await row(page, 'QA Pi 5').innerText(), /http:\/\/192\.168\.1\.50/);
        assert.match(await row(page, 'QA Pi 5').innerText(), /Nothing assigned yet/);
        await page.getByRole('status').filter({ hasText: 'Machine added.' }).waitFor();
        assert.equal(await form.getByLabel('Name').inputValue(), '', 'the form clears');
        assert.deepEqual(backend.audits.map((a) => a.action), ['machines.add']);
        if (SHOTS) { await row(page, 'QA Pi 5').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1638-added-${width}-${theme}.png`) }); }
      });

      await check(`${tag}: a public address is refused and nothing is added`, async () => {
        const form = page.getByRole('form', { name: 'Add a machine' });
        await form.getByLabel('Name').fill('QA Cloud');
        await form.getByLabel('Address').fill('8.8.8.8');
        await form.getByRole('button', { name: 'Add machine' }).click();
        await page.getByRole('alert').filter({ hasText: 'That address is not on this network. Use a LAN or Tailscale address.' }).waitFor({ timeout: 10000 });
        assert.equal(await row(page, 'QA Cloud').count(), 0);
        assert.equal(await page.locator('.machines-row').count(), 2);
        assert.deepEqual(backend.audits.map((a) => a.action), ['machines.add']);
        if (SHOTS) { await page.getByRole('alert').filter({ hasText: 'That address is not on this network' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1638-public-refused-${width}-${theme}.png`) }); }
      });

      await check(`${tag}: moving embeddings asks for the re-index first, then starts it at the new address`, async () => {
        const embed = page.locator('.machines-assign[data-service="embedding"]');
        await embed.getByLabel('Machine for Embeddings (projects and Diary)').selectOption({ label: 'QA Pi 5' });
        await embed.getByLabel('Port for Embeddings (projects and Diary)').fill('8081');
        await embed.getByRole('button', { name: 'Move' }).click();
        const prompt = page.getByRole('region', { name: 'Re-index needed' });
        await prompt.waitFor({ timeout: 10000 });
        assert.match(await prompt.innerText(), new RegExp(`Moving embeddings to QA Pi 5 re-indexes every project and the Diary with ${EMBED} at the new address`));
        assert.deepEqual(record.embedding, [], 'nothing re-indexed before the confirmation');
        assert.ok(!backend.audits.some((a) => a.action === 'machines.assign'), 'nothing saved for embeddings');
        if (SHOTS) { await prompt.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `1638-reindex-prompt-${width}-${theme}.png`) }); }
        await prompt.getByRole('button', { name: 'Re-index and move' }).click();
        await page.getByRole('status').filter({ hasText: 'Re-index started. Embeddings move to QA Pi 5 when it finishes' }).waitFor({ timeout: 10000 });
        assert.equal(record.embedding[0].action, 'set-next');
        assert.deepEqual(record.embedding[0].target, { baseUrl: 'http://192.168.1.50:8081/v1', model: EMBED, profile: 'embeddinggemma-2' });
        assert.equal(await page.getByRole('region', { name: 'Re-index needed' }).count(), 0);
      });

      await check(`${tag}: the decision service moves at once to the machine's port`, async () => {
        const decision = page.locator('.machines-assign[data-service="decision"]');
        await decision.getByLabel('Machine for Decisions (Laya/Kev)').selectOption({ label: 'QA Pi 5' });
        await decision.getByLabel('Port for Decisions (Laya/Kev)').fill('8040');
        await decision.getByRole('button', { name: 'Apply' }).click();
        await page.getByRole('status').filter({ hasText: 'Saved. The service uses its new machine now.' }).waitFor({ timeout: 10000 });
        assert.equal(backend.machines.urlFor('decision'), 'http://192.168.1.50:8040');
        await row(page, 'QA Pi 5').filter({ hasText: 'Decisions (Laya/Kev)' }).waitFor({ timeout: 10000 });
      });
      assert.deepEqual(errors, []);
      await page.close();

      await check(`${tag}: a member has no Inference machines entry and a deep link never calls the admin API`, async () => {
        const memberState = await createState({ member: true });
        const memberRecord = { machines: [], embedding: [] };
        try {
          const member = await openPage(browser, memberState, { width, height, theme });
          await wire(member.page, machinesBackend('member'), memberRecord);
          await member.page.goto(`${origin}/settings/machines`);
          await member.page.locator('.settings-title h1').waitFor({ timeout: 15000 });
          await member.page.waitForTimeout(1200);
          assert.notEqual((await member.page.locator('.settings-title h1').innerText()).trim(), 'Inference machines');
          assert.deepEqual(memberRecord.machines, [], 'no admin request');
          assert.equal(await member.page.locator('.inference-machines').count(), 0);
          // Phones show the list as its own screen; desktop shows it beside the page.
          if (width < 800) { const back = member.page.getByRole('button', { name: 'All settings' }); if (await back.isVisible()) await back.click(); }
          assert.equal(await member.page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Inference machines' }).count(), 0);
          if (SHOTS) await member.page.screenshot({ path: path.join(SHOTS, `1638-member-${width}-${theme}.png`) });
          await member.page.close();
        } finally { memberState.close(); }
      });
    } finally { state.close(); }
  }
});
