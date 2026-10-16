'use strict';
// #1880: Settings → Inference machines lets an administrator measure a chat role's model on its machine: a confirmation
// first, then step-by-step progress with a Stop button, then the result (generation and prompt-reading speed,
// speculative-decoding acceptance) and the flags suggested for that machine on the role's row. Stop ends a run and
// saves nothing.
//
// 2000 and 390 px, light and dark. Offline: the app is built from this checkout; /api/models/machines is noevia-core's
// REAL registry, route, chat-machines and machine-tune code over an in-memory store, with a synthetic IP address and a
// stubbed on-this-network fetch: port 8080 of 192.168.1.50 is a fake llama-server (/health, /v1/models, /props and
// /v1/chat/completions with llama.cpp timings and drafted/accepted counts), whose answer delay the script controls.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/inference-machines-tune-1880.cjs
// Fails on a build without the change (no Measure button), passes with it (with a core that has machine-tune.cjs).
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createState, openPage, run, VIEWS, SHOTS, CORE } = require('./models-state-fixture.cjs');

const core = (file) => require(path.join(CORE, file));
const hasCore = fs.existsSync(path.join(CORE, 'chat-machines.cjs'));
const MODEL = 'qa-synthetic-fast-4b';

function fakeLlamaServer() {
  const server = { delayMs: 60, chats: 0 };
  server.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname !== '192.168.1.50' || url.port !== '8080') throw Object.assign(Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    if (url.pathname === '/health') return new Response('{"status":"ok"}', { status: 200 });
    if (url.pathname === '/v1/models') return new Response(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }), { status: 200 });
    if (url.pathname === '/props') return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 32768 }, chat_template: '{{ messages }}' }), { status: 200 });
    if (url.pathname === '/v1/chat/completions') {
      server.chats++;
      const body = JSON.parse(init.body);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, server.delayMs);
        init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); }, { once: true });
      });
      const chars = JSON.stringify(body.messages).length;
      const long = chars > 40000;
      const promptN = Math.round(chars / 6);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: promptN, completion_tokens: body.max_tokens },
        timings: { prompt_n: promptN, prompt_per_second: long ? 200 : 600, predicted_n: body.max_tokens, predicted_per_second: 25, draft_n: 100, draft_n_accepted: 30 } }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  return server;
}

async function machinesBackend() {
  assert.ok(hasCore, `noevia-core server not found at ${CORE}`);
  const fake = fakeLlamaServer();
  const values = new Map();
  const store = { get: (k) => values.get(k), set: (k, v) => values.set(k, v), delete: (k) => values.delete(k) };
  const machines = core('inference-machines.cjs').createInferenceMachines({ store, audit: () => {}, embeddingActive: () => null, localEmbeddingUrl: () => null, log: () => {}, modelsAt: (address, port) => chatMachines.modelsAt(address, port) });
  const health = core('machine-health.cjs').createMachineHealth({ fetchImpl: fake.fetch, decisionFetchImpl: fake.fetch });
  const chatMachines = core('chat-machines.cjs').createChatMachines({ machines, health, fetchImpl: fake.fetch });
  const machineTune = fs.existsSync(path.join(CORE, 'machine-tune.cjs')) ? core('machine-tune.cjs').createMachineTune({ machines, chatMachines, store, log: () => {} }) : null;
  const routes = core('routes/inference-machines.cjs').createInferenceMachineRoutes({
    json: (res, status, body) => { res.out = { status, body }; return true; }, readJson: async (req) => req.body, machines, health, chatMachines, machineTune,
    effective: { decision: () => null, embedding: () => null, reranker: () => null },
  });
  const { machine } = await machines.add({ name: 'QA Pi 5', address: '192.168.1.50' }, 'qa-admin');
  machines.assign({ service: 'chatFast', machine: machine.id, port: 8080, model: MODEL }, 'qa-admin');
  return {
    fake,
    async handle(method, url, body) {
      const res = { setHeader() {} };
      await routes({ method, body }, res, { path: url.pathname, authn: { user: { id: 'qa-admin', role: 'admin' } }, url });
      return res.out;
    },
  };
}

const shot = async (page, name, width, theme) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1880-${name}-${width}-${theme}.png`) }); };
const inside = async (loc, width) => { const box = await loc.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'stays inside the viewport'); };

run('inference-machines-tune-1880', Number(process.env.QA_PORT || 31880), async (check, browser, origin) => {
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
      const fast = page.locator('.machines-assign[data-service="chatFast"]');

      await check(`${tag}: Measure asks first, and nothing is sent until it is confirmed`, async () => {
        await page.goto(`${origin}/settings/machines`);
        await fast.waitFor({ timeout: 15000 });
        const measure = fast.locator('[data-action="tune"]');
        await measure.waitFor({ timeout: 15000 });
        assert.equal((await measure.innerText()).trim(), 'Measure on QA Pi 5');
        await measure.click();
        const confirm = fast.locator('[data-note="tune-confirm"]');
        await confirm.waitFor({ timeout: 5000 });
        assert.match(await confirm.innerText(), /Measure qa-synthetic-fast-4b on QA Pi 5\? noevia sends a few short synthetic requests/);
        assert.equal(backend.fake.chats, 0, 'nothing was sent before the confirmation');
        await inside(confirm, width);
        await confirm.scrollIntoViewIfNeeded();
        await shot(page, 'confirm', width, theme);
      });

      await check(`${tag}: the run finishes and the role shows the measured speeds and the suggested flags`, async () => {
        await fast.locator('[data-action="tune-start"]').click();
        const tuned = fast.locator('[data-note="tuned"]');
        await tuned.waitFor({ timeout: 20000 });
        const text = (await tuned.innerText()).trim();
        assert.match(text, /^Measured on QA Pi 5 \(.+\): generation 25 tokens\/s · reads 600 tokens\/s at [\d,]+ tokens · reads 600 tokens\/s at [\d,]+ tokens · reads 200 tokens\/s at [\d,]+ tokens · speculative decoding 30% accepted\./);
        assert.match(text, /Suggested on QA Pi 5: --ctx-size 23552 \(filling 32,768 tokens takes about 164 s\)\./);
        assert.match(text, /Suggested on QA Pi 5: --spec-type none \(only 30% of drafted tokens accepted\)\./);
        assert.equal((await fast.locator('[data-note="tune-outcome"]').innerText()).trim(), 'Measured qa-synthetic-fast-4b on QA Pi 5.');
        const measured = (await fast.locator('[data-note="measured"]').innerText()).trim();
        assert.match(measured, /Presets and long-context profiles: not measured on QA Pi 5\.$/);
        assert.equal(backend.fake.chats, 6, 'three generation workloads and three prompt sizes');
        await inside(tuned, width);
        await tuned.scrollIntoViewIfNeeded();
        await shot(page, 'result', width, theme);
      });

      await check(`${tag}: Stop ends a running measurement and saves nothing new`, async () => {
        backend.fake.delayMs = 4000;
        await fast.locator('[data-action="tune"]').click();
        await fast.locator('[data-action="tune-start"]').click();
        const running = fast.locator('[data-note="tune-running"]');
        await running.waitFor({ timeout: 5000 });
        assert.match(await running.innerText(), /Measuring on QA Pi 5: step \d of \d/);
        await running.scrollIntoViewIfNeeded();
        await shot(page, 'running', width, theme);
        await fast.locator('[data-action="tune-stop"]').click();
        const outcome = fast.locator('[data-note="tune-outcome"]');
        await page.waitForFunction(() => document.querySelector('.machines-assign[data-service="chatFast"] [data-note="tune-outcome"]')?.textContent?.includes('stopped'), null, { timeout: 5000 });
        assert.equal((await outcome.innerText()).trim(), 'Measurement stopped. Nothing was saved.');
        assert.equal(await fast.locator('[data-note="tuned"]').count(), 1, 'the earlier result stays');
      });

      await check(`${tag}: a role on this machine has no Measure button`, async () => {
        const smart = page.locator('.machines-assign[data-service="chatSmart"]');
        await smart.waitFor({ timeout: 5000 });
        assert.equal(await smart.locator('[data-action="tune"]').count(), 0);
      });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { state.close(); }
  }
});
