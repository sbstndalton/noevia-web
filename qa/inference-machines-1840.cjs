'use strict';
// #1840: Settings → Inference machines, chat roles. An administrator moves Fast chat to a machine on this network:
// picks the machine and port, asks the machine for its models (its /v1/models, through the server), picks one and
// applies. The row then names the model and the machine's health; the machine's card lists Fast chat. A port where
// nothing answers says so. A member never sees the page (no entry, a deep link never calls the admin API).
//
// 2000 and 390 px, light and dark. Offline: the app is built from this checkout; /api/models/machines is noevia-core's
// REAL registry, route and chat-machines code over an in-memory store (models-state-fixture.cjs), with synthetic IP
// addresses and a stubbed on-this-network fetch: port 8080 of the machine lists two synthetic models and answers its
// health check; any other port refuses the connection.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/inference-machines-1840.cjs
// Fails on a build without the change (the chat rows offer no machine), passes with it.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, CORE } = require('./models-state-fixture.cjs');

const core = (file) => require(path.join(CORE, file));
const hasCore = fs.existsSync(path.join(CORE, 'chat-machines.cjs'));
const REMOTE = ['qa-synthetic-fast-4b', 'qa-synthetic-smart-9b'];

/** The machine's server, as the on-this-network fetch would reach it: only http://192.168.1.50:8080 answers. */
async function machineFetch(input) {
  const url = new URL(String(input));
  if (!['192.168.1.50', '192.168.1.51'].includes(url.hostname) || url.port !== '8080') throw Object.assign(Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  if (url.pathname === '/health') return new Response('{"status":"ok"}', { status: 200 });
  if (url.pathname === '/v1/models') return new Response(JSON.stringify({ object: 'list', data: (url.hostname === '192.168.1.51' ? ['qa-synthetic-other-7b'] : REMOTE).map((id) => ({ id, object: 'model' })) }), { status: 200 });
  return new Response('not found', { status: 404 });
}

/** The machines route over core's real code, for one role. Returns null when this core has no chat machines. */
function machinesBackend(role) {
  if (!hasCore) return null;
  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const audits = [];
  const audit = (action, actor, detail) => audits.push({ action, actor, detail });
  const machines = core('inference-machines.cjs').createInferenceMachines({ store, audit, embeddingActive: () => null, localEmbeddingUrl: () => null, log: () => {}, modelsAt: (address, port) => chatMachines.modelsAt(address, port) });
  const health = core('machine-health.cjs').createMachineHealth({ fetchImpl: machineFetch, decisionFetchImpl: machineFetch });
  const chatMachines = core('chat-machines.cjs').createChatMachines({ machines, health, fetchImpl: machineFetch });
  const routes = core('routes/inference-machines.cjs').createInferenceMachineRoutes({
    json: (res, status, body) => { res.out = { status, body }; return true; }, readJson: async (req) => req.body, machines, health, chatMachines,
    effective: { decision: () => null, embedding: () => null, reranker: () => null },
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

async function wire(page, backend, record) {
  await page.route(/\/api\/models\/machines(\?.*)?$/, async (route) => {
    const req = route.request(), url = new URL(req.url());
    record.push(`${req.method()} ${url.pathname}${url.search}`);
    let body; try { body = req.postDataJSON() ?? undefined; } catch { body = undefined; }
    const out = backend ? await backend.handle(req.method(), url, body) : { status: 404, body: { error: 'Not found' } };
    return route.fulfill({ status: out.status, json: out.body });
  });
}

const row = (page, name) => page.locator('.machines-row', { has: page.locator('.model-name', { hasText: name }) });
const shot = async (page, name, width, theme) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1840-${name}-${width}-${theme}.png`) }); };

run('inference-machines-1840', Number(process.env.QA_PORT || 31840), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState();
    const backend = machinesBackend('admin');
    const record = [];
    try {
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      await wire(page, backend, record);

      await check(`${tag}: every chat role row offers a machine, defaulting to this one`, async () => {
        await page.goto(`${origin}/settings/machines`);
        const settings = page.getByRole('dialog', { name: 'Settings' });
        await settings.locator('.settings-title h1', { hasText: 'Inference machines' }).waitFor({ timeout: 15000 });
        await page.locator('.machines-row').first().waitFor({ timeout: 10000 });
        for (const [id, label] of [['chatFast', 'Fast chat'], ['chatSmart', 'Smart chat'], ['chatCode', 'Code chat'], ['chatCreative', 'Creative chat'], ['vision', 'Vision']]) {
          const r = page.locator(`.machines-assign[data-service="${id}"]`);
          await r.waitFor({ timeout: 5000 });
          const select = r.getByLabel(`Machine for ${label}`);
          assert.equal(await select.count(), 1, `${id} has a machine choice`);
          assert.equal((await select.locator('option:checked').innerText()).trim(), 'This machine', id);
        }
        assert.equal(await page.getByText('Chat models stay on this machine for now.').count(), 0);
        await page.locator('.machines-assign[data-service="chatFast"]').scrollIntoViewIfNeeded();
        await shot(page, 'default', width, theme);
      });

      await check(`${tag}: an administrator moves Fast chat to a machine with a model it serves`, async () => {
        const form = page.getByRole('form', { name: 'Add a machine' });
        await form.getByLabel('Name').fill('QA Pi 5');
        await form.getByLabel('Address').fill('192.168.1.50');
        await form.getByRole('button', { name: 'Add machine' }).click();
        await row(page, 'QA Pi 5').waitFor({ timeout: 10000 });

        const fast = page.locator('.machines-assign[data-service="chatFast"]');
        await fast.getByLabel('Machine for Fast chat').selectOption({ label: 'QA Pi 5' });
        await fast.getByLabel('Port for Fast chat').fill('8080');
        await fast.getByRole('button', { name: 'Find models' }).click();
        const model = fast.getByLabel('Model for Fast chat');
        await model.waitFor({ timeout: 10000 });
        assert.deepEqual((await model.locator('option').allInnerTexts()).map((s) => s.trim()), REMOTE);
        await model.selectOption('qa-synthetic-fast-4b');
        await fast.scrollIntoViewIfNeeded();
        await shot(page, 'fast-picking', width, theme);
        await fast.getByRole('button', { name: 'Apply' }).click();
        await page.getByRole('status').filter({ hasText: 'Saved. The service uses its new machine now.' }).waitFor({ timeout: 10000 });
        const target = backend.machines.chatTarget('fast');
        assert.equal(target.model, 'qa-synthetic-fast-4b');
        assert.equal(target.baseUrl, 'http://192.168.1.50:8080');
        assert.ok(backend.audits.some((a) => a.action === 'machines.assign' && a.detail.service === 'chatFast' && a.detail.model === 'qa-synthetic-fast-4b'));
        await row(page, 'QA Pi 5').filter({ hasText: 'Fast chat' }).waitFor({ timeout: 10000 });
        await fast.filter({ hasText: 'Answers from qa-synthetic-fast-4b on that machine' }).waitFor({ timeout: 10000 });
        await fast.locator('.mm-state', { hasText: 'Answering' }).waitFor({ timeout: 10000 });
        assert.equal(backend.machines.chatTarget('smart'), null, 'only Fast moved');
        await fast.scrollIntoViewIfNeeded();
        await shot(page, 'fast-on-machine', width, theme);
      });

      await check(`${tag}: a port where nothing answers says so and saves nothing`, async () => {
        const smart = page.locator('.machines-assign[data-service="chatSmart"]');
        await smart.getByLabel('Machine for Smart chat').selectOption({ label: 'QA Pi 5' });
        await smart.getByLabel('Port for Smart chat').fill('9999');
        await smart.getByRole('button', { name: 'Find models' }).click();
        await smart.getByRole('alert').filter({ hasText: 'The machine did not answer at that port.' }).waitFor({ timeout: 10000 });
        assert.equal(await smart.getByLabel('Model for Smart chat').count(), 0);
        assert.equal(backend.machines.chatTarget('smart'), null);
        await smart.scrollIntoViewIfNeeded();
        await shot(page, 'port-not-answering', width, theme);
        await smart.getByLabel('Machine for Smart chat').selectOption({ label: 'This machine' });
      });

      await check(`${tag}: a changed address whose server no longer lists the model shows a confirm note`, async () => {
        const fast = page.locator('.machines-assign[data-service="chatFast"]');
        assert.equal(await fast.locator('[data-note="confirm-model"]').count(), 0, 'no note before the change');
        await backend.machines.update({ id: backend.machines.chatTarget('fast').machine.id, address: '192.168.1.51' }, 'qa-admin');
        assert.equal(backend.machines.chatTarget('fast').needsConfirm, true);
        await page.reload();
        const note = fast.locator('[data-note="confirm-model"]');
        await note.waitFor({ timeout: 15000 });
        assert.match(await note.innerText(), /qa-synthetic-fast-4b/);
        await fast.scrollIntoViewIfNeeded();
        await shot(page, 'confirm-model', width, theme);
      });
      assert.deepEqual(errors, []);
      await page.close();

      await check(`${tag}: a member has no Inference machines entry and a deep link never calls the admin API`, async () => {
        const memberState = await createState({ member: true });
        const memberRecord = [];
        try {
          const member = await openPage(browser, memberState, { width, height, theme });
          await wire(member.page, machinesBackend('member'), memberRecord);
          await member.page.goto(`${origin}/settings/machines`);
          await member.page.locator('.settings-title h1').waitFor({ timeout: 15000 });
          await member.page.waitForTimeout(1200);
          assert.notEqual((await member.page.locator('.settings-title h1').innerText()).trim(), 'Inference machines');
          assert.deepEqual(memberRecord, [], 'no admin request');
          assert.equal(await member.page.locator('.inference-machines').count(), 0);
          if (width < 800) { const back = member.page.getByRole('button', { name: 'All settings' }); if (await back.isVisible()) await back.click(); }
          assert.equal(await member.page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Inference machines' }).count(), 0);
          await shot(member.page, 'member', width, theme);
          await member.page.close();
        } finally { memberState.close(); }
      });
    } finally { state.close(); }
  }
});
