// UI-only fixture for the guided model manager (#204): no real models, inference or storage.
// Synthetic numbers in realistic ranges (a 9B Q5 hybrid model on a 32 GiB shared-memory GPU).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const OUT = process.env.QA_SCREENSHOTS || '/tmp';
const rows = [4096, 8192, 16384, 32768, 65536, 131072, 262144].map(ctx => ({ ctx, kvQ8Gib: Math.round(ctx / 32768 * 0.5 * 100) / 100 }));
(async () => {
  const fixture = createFixture(31351); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [], posts = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      const json = (body, status = 200) => route.fulfill({ json: body, status });
      if (req.method() === 'POST' && p.startsWith('/api/models/')) posts.push(p);
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true });
      if (p === '/api/models/installed') return json([
        { name: 'Synthetic-9B-Q5', loaded: true, labels: ['vision'], sizeGB: 6.6, status: 'loaded' },
        { name: 'Synthetic-4B-Q5', loaded: false, labels: [], sizeGB: 3.1, status: 'unloaded' },
        { name: 'Synthetic-20B-MoE', loaded: false, labels: [], sizeGB: 11.6, status: 'unloaded' },
        { name: 'laya_multilingual_f16', loaded: true, labels: [], sizeGB: 1.1, status: 'loaded' },
        { name: 'synthetic-embed-v1', loaded: false, labels: ['embeddings'], sizeGB: 0.3, status: 'unloaded' },
        { name: 'synthetic-reranker-0.6b', loaded: false, labels: ['reranking'], sizeGB: 0.6, status: 'unloaded' }]);
      if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: 'Synthetic-4B-Q5', smart: 'Synthetic-9B-Q5', vision: 'Synthetic-9B-Q5' }, missing: [] });
      if (p === '/api/models/evidence') {
        const m = new URL(req.url()).searchParams.get('model');
        const at = Date.parse('2026-09-22T10:00:00Z');
        if (m === 'Synthetic-20B-MoE') return json({ tracked: true, categories: [{ category: 'context_capacity', state: 'failed', value: null, at, suite: null, limitations: ['Long prompt exceeded 120 s'] }, { category: 'throughput', state: 'unverified', value: null, at: null, suite: null, limitations: [] }] });
        return json({ tracked: true, categories: [{ category: 'context_capacity', state: 'verified', value: { ctx: m === 'Synthetic-4B-Q5' ? 24576 : 16384 }, at, suite: { name: 'calibration', version: 2 }, limitations: [] }, { category: 'throughput', state: 'verified', value: { rate: m === 'Synthetic-4B-Q5' ? 41.2 : 23.8 }, at, suite: null, limitations: [] }] });
      }
      if (p === '/api/models/estimate') return json({ model: 'Synthetic-9B-Q5', budgetGib: null, chat: true, sizeable: true, arch: 'qwen35', nativeCtx: 262144, modelGib: 6.15, pinnedGib: 1.43, reserveGib: 1, safety: 1.05, moe: false, rows, current: { ctx: 16384, kv: 'q8_0' } });
      if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [{ id: 'amd_gpu:0', name: 'Synthetic iGPU', capacityGB: 4, sharedGB: 10 }] });
      if (p === '/api/models/autotune') return json({ job: { id: 't9', model: 'Synthetic-20B-MoE', status: 'failed', phase: 'KV cache', error: 'No KV cache type passed quality and throughput checks.', models: [{ model: 'Synthetic-20B-MoE', status: 'failed', phases: [] }] }, history: [{ at: Date.parse('2026-09-20T09:00:00Z'), specLabel: 'MTP draft', generation: 23.8, kv: 'q8_0', context: 16384 }] });
      if (p === '/api/models/calibration') return json({ job: { id: 'c1', model: 'Synthetic-4B-Q5', status: 'interrupted', phase: 'Loading 32,768', startedAt: Date.now() - 3600e3 }, history: [] });
      if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
      if (p === '/api/model-manager/downloads') return json({ jobs: [{ id: 'd1', repo: 'synthetic/Synthetic-12B-GGUF', filename: 'Synthetic-12B-Q5_K_M.gguf', status: 'error', error: 'HTTP 503 from the mirror', bytes: 8e9, downloaded: 2e9, pct: 25, speedH: '', etaH: '', parallel: false, chunks: [] }] });
      if (p === '/api/model-manager/backends') return json({ backends: [{ name: 'llama-server', found: true, status: 'running', image: 'x', uptime: '3h', started_at: '', loaded_model: 'Synthetic-9B-Q5', probe_error: null, last_restart_error: null, stats: { ok: false, error: null, gpu: null, container: null }, history: [] }] });
      if (p === '/api/model-manager/models') return json({ models: [], unregistered: [] });
      if (p === '/api/model-manager/models/updates') return json({ status: {} });
      if (p.startsWith('/api/model-manager/sections')) return json({ sections: [], values: {}, extras: '', revision: 'r1', exists: true, fields: [] });
      if (p.startsWith('/api/model-manager/')) return json({});
      return route.continue();
    });
    await page.goto('http://localhost:31351');
    await page.getByTitle('Settings', { exact: true }).click();
    const settings = page.getByRole('region', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const manager = page.locator('.model-manager-page');
    await manager.getByRole('tab', { name: 'Overview' }).click();
    await manager.getByText('No KV cache type passed quality and throughput checks.').waitFor();
    await manager.getByText(/Model loader/).waitFor();
    await manager.getByText(/Context verified · 16,384 tokens/).first().waitFor();
    assert.equal(await manager.locator('.mm-role-list li', { hasText: 'laya_multilingual_f16' }).getByRole('button').count(), 0, 'Laya has no controls');
    const shots = [];
    for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      assert.ok(await manager.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'overflow ' + width + ' ' + theme);
      await manager.getByRole('heading', { name: 'Recover' }).scrollIntoViewIfNeeded();
      const f = `${OUT}/guided-overview-${width}-${theme}.png`; await page.screenshot({ path: f, fullPage: true }); shots.push(f);
    }
    await page.setViewportSize({ width: 1440, height: 950 });
    await manager.locator('.mm-role-list li', { hasText: 'Synthetic-9B-Q5' }).getByRole('button', { name: 'Optimize' }).click();
    const guided = manager.getByRole('region', { name: 'Optimize this model' });
    await guided.getByText(/About .* GiB of 14 GiB/).waitFor();
    await guided.getByText('Recommendation:').waitFor();
    await guided.getByLabel('KV cache').selectOption('q4_0');
    await guided.getByText(/below the q5_0 floor/).waitFor();
    await guided.getByLabel('KV cache').selectOption('q8_0');
    await guided.getByText(/Expected time: about/).waitFor();
    for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      assert.ok(await manager.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'overflow detail ' + width + ' ' + theme);
      await guided.scrollIntoViewIfNeeded();
      const f = `${OUT}/guided-optimize-${width}-${theme}.png`; await guided.screenshot({ path: f }); shots.push(f);
    }
    assert.deepEqual(posts, [], 'the guided flow never posts by itself');
    assert.deepEqual(errors, []);
    console.log(shots.join('\n'));
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exit(1); });
