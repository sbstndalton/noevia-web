'use strict';
// #1854: Settings → Inference machines shows, on a chat role that runs on a machine, what was measured there for its
// model (from that machine's own /props: context, thinking switch, image input), and names the measurements that
// belong to this machine's engine (auto-tune, presets, long-context profiles, speculative decoding) as not measured on
// that machine. A role on this machine shows no such line.
//
// 2000 and 390 px, light and dark. Offline: the app is built from this checkout; /api/models/machines is noevia-core's
// REAL registry, route and chat-machines code over an in-memory store (models-state-fixture.cjs), with synthetic IP
// addresses and a stubbed on-this-network fetch: port 8080 of 192.168.1.50 answers /health, /v1/models and /props.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/inference-machines-1854.cjs
// Fails on a build without the change (no measured line), passes with it (with a core that reports `measured`).
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, CORE } = require('./models-state-fixture.cjs');

const core = (file) => require(path.join(CORE, file));
const hasCore = fs.existsSync(path.join(CORE, 'chat-machines.cjs'));
const MODEL = 'qa-synthetic-fast-4b';
// A synthetic chat template that reads the thinking switch.
const TEMPLATE = '{% for m in messages %}{{ m.role }}{{ m.content }}{% endfor %}{% if enable_thinking is defined and enable_thinking is false %}<no-think>{% endif %}';

async function machineFetch(input) {
  const url = new URL(String(input));
  if (url.hostname !== '192.168.1.50' || url.port !== '8080') throw Object.assign(Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  if (url.pathname === '/health') return new Response('{"status":"ok"}', { status: 200 });
  if (url.pathname === '/v1/models') return new Response(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }), { status: 200 });
  if (url.pathname === '/props') return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 32768 }, chat_template: TEMPLATE, modalities: { vision: false } }), { status: 200 });
  return new Response('not found', { status: 404 });
}

async function machinesBackend() {
  assert.ok(hasCore, `noevia-core server not found at ${CORE}`);
  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const machines = core('inference-machines.cjs').createInferenceMachines({ store, audit: () => {}, embeddingActive: () => null, localEmbeddingUrl: () => null, log: () => {}, modelsAt: (address, port) => chatMachines.modelsAt(address, port) });
  const health = core('machine-health.cjs').createMachineHealth({ fetchImpl: machineFetch, decisionFetchImpl: machineFetch });
  const chatMachines = core('chat-machines.cjs').createChatMachines({ machines, health, fetchImpl: machineFetch });
  const routes = core('routes/inference-machines.cjs').createInferenceMachineRoutes({
    json: (res, status, body) => { res.out = { status, body }; return true; }, readJson: async (req) => req.body, machines, health, chatMachines,
    effective: { decision: () => null, embedding: () => null, reranker: () => null },
  });
  const { machine } = await machines.add({ name: 'QA Pi 5', address: '192.168.1.50' }, 'qa-admin');
  machines.assign({ service: 'chatFast', machine: machine.id, port: 8080, model: MODEL }, 'qa-admin');
  return {
    async handle(method, url, body) {
      const res = { setHeader() {} };
      await routes({ method, body }, res, { path: url.pathname, authn: { user: { id: 'qa-admin', role: 'admin' } }, url });
      return res.out;
    },
  };
}

const shot = async (page, name, width, theme) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1854-${name}-${width}-${theme}.png`) }); };

run('inference-machines-1854', Number(process.env.QA_PORT || 31854), async (check, browser, origin) => {
  for (const [width, height, theme] of VIEWS) {
    const tag = `${width} px ${theme}`;
    const state = await createState();
    try {
      const backend = await machinesBackend();
      const { page, errors } = await openPage(browser, state, { width, height, theme });
      await page.route(/\/api\/models\/machines(\?.*)?$/, async (route) => {
        const req = route.request();
        let body; try { body = req.postDataJSON() ?? undefined; } catch { body = undefined; }
        const out = await backend.handle(req.method(), new URL(req.url()), body);
        return route.fulfill({ status: out.status, json: out.body });
      });

      await check(`${tag}: Fast chat on a machine shows what that machine measured, and what it does not measure`, async () => {
        await page.goto(`${origin}/settings/machines`);
        const fast = page.locator('.machines-assign[data-service="chatFast"]');
        await fast.waitFor({ timeout: 15000 });
        const note = fast.locator('[data-note="measured"]');
        await note.waitFor({ timeout: 15000 });
        const text = (await note.innerText()).trim();
        assert.equal(text, 'Measured on QA Pi 5: context 32,768 tokens · has a thinking switch · does not read images. Auto-tune, presets, long-context profiles and speculative decoding: not measured on QA Pi 5.');
        assert.ok(await note.isVisible());
        const box = await note.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'the line stays inside the viewport');
        await fast.scrollIntoViewIfNeeded();
        await shot(page, 'measured', width, theme);
      });

      await check(`${tag}: a role on this machine shows no measured line`, async () => {
        const smart = page.locator('.machines-assign[data-service="chatSmart"]');
        await smart.waitFor({ timeout: 5000 });
        assert.equal(await smart.locator('[data-note="measured"]').count(), 0);
        assert.equal(await page.locator('[data-note="measured"]').count(), 1, 'only the role on a machine');
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); }
  }
});
