// #1159 — Discover says WHY a file has no context estimate. The model manager now returns
// estimatesReason (e.g. autoconfig's refusal for a hybrid model whose attention layers it cannot
// count); the file row shows it in place of the bare "No context estimate for this file". A row
// without a reason keeps the bare text. Synthetic model-manager APIs only; no model runs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings, openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const PORT = Number(process.env.QA_PORT || 31181);
const REASON = "Cannot size the KV cache from this model's metadata: it is a hybrid model whose attention_head_count_kv marks non-attention layers with 0, and only the first 8 of its 30 entries are readable, so the number of attention layers is unknown.";
const NAME = 'synthetic-12b-it';
const schema = [{ tier: 'Common', open: true, fields: [{ key: 'ctx-size', label: 'Context size', kind: 'int', choices: [], placeholder: '8192', help: '0 = load from model metadata.' }] }];
(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const problems = [];
  const check = async (label, fn) => { try { await fn(); } catch (e) { problems.push(label + ': ' + String(e.message).split('\n')[0]); console.log('FAIL', label, String(e.message).split('\n')[0]); } };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 1000 } }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const puts = [];
    let putMode = 'conflict';
    await page.route('**/api/**', async route => {
      const req = route.request(), u = new URL(req.url()), p = u.pathname;
      const json = (body, status = 200) => route.fulfill({ json: body, status });
      if (p === '/api/models/autotune/settings' || (p === '/api/models/autotune' && req.method() === 'GET')) return json({ job: null, history: [], kvCandidates: ['bf16'], settings: { allowQ5Kv: false }, planImpl: 'wasm', loadAdvisor: 'off', modes: { fast: { defaultSeconds: 120, maxSeconds: 1800 }, long: { defaultSeconds: 1800, maxSeconds: 1800 } } });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, modelManagement: true });
      if (p === '/api/models/installed') return json([{ name: NAME, loaded: false, labels: [], sizeGB: 7.3, status: 'unloaded' }]);
      if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: NAME, smart: NAME }, missing: [] });
      if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
      if (p === '/api/models/estimate') return json({ model: NAME, budgetGib: 16, chat: true, sizeable: true, arch: 'gemma3', nativeCtx: 131072, modelGib: 7, pinnedGib: 0, reserveGib: 1, safety: 1.05, moe: false, rows: [], current: { ctx: 16384, kv: 'bf16' } });
      if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [] });
      if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
      if (p === '/api/models/calibration') return json({ job: null, history: [] });
      if (p === '/api/model-manager/sections') return json({ revision: 'r1', schema, sections: [{ name: NAME, items: [['ctx-size', '16384']], hasFile: true, file: NAME + '/' + NAME + '.gguf', cli: 'llama-server' }], unregistered: [], backups: [] });
      if (p.startsWith('/api/model-manager/sections/') && p.endsWith('/autoconfig')) return json({});
      if (p.startsWith('/api/model-manager/sections/') && req.method() === 'PUT') {
        const body = req.postDataJSON(); puts.push(body);
        if (putMode === 'budget') return json({ error: 'Not saved: with these settings synthetic needs about 40 GiB, above the 16 GiB inference memory budget.', code: 'inference_budget' }, 409);
        return json({ error: 'models.ini changed since you loaded it.' }, 409);
      }
      if (p.startsWith('/api/model-manager/sections/')) return json({ name: NAME, exists: true, values: { 'ctx-size': '16384' }, extras: '', hints: [], revision: 'r1', schema });
      if (p === '/api/model-manager/downloads') return json({ jobs: [] });
      if (p === '/api/model-manager/search/repo') return json({ repo: 'synthetic/d1-3B-GGUF', gated: '', groups: [
        { shardBase: 'd1-Q4_K_M.gguf', shards: null, bytes: 2e9, size: '1.9 GiB', quant: 'Q4_K_M', projector: false, fit: [{ name: 'vulkan-0', verdict: 'fits', ratio_pct: 20 }, { name: 'cpu-ram', verdict: 'fits', ratio_pct: 10 }], files: [{ path: 'd1-Q4_K_M.gguf', bytes: 2e9, size: '1.9 GiB' }], estimates: [], estimatesReason: REASON, nativeCtx: 32768 },
        { shardBase: 'd1-Q8_0.gguf', shards: null, bytes: 3e9, size: '2.8 GiB', quant: 'Q8_0', projector: false, fit: [{ name: 'vulkan-0', verdict: 'fits', ratio_pct: 30 }], files: [{ path: 'd1-Q8_0.gguf', bytes: 3e9, size: '2.8 GiB' }], estimates: [], nativeCtx: 32768 }] });
      if (p === '/api/model-manager/search') return json({ results: [{ id: 'synthetic/d1-3B-GGUF', owner: 'synthetic', downloads: 10, likes: 1, lastModified: '2026-09-01', ageDays: 16, license: 'apache-2.0', params: 3, activeParams: null, moe: false, vision: false, trusted: true, suitable: true, reasons: [], options: [{ path: 'd1-Q4_K_M.gguf', gb: 1.9, quant: 'Q4_K_M', shards: 1, fits: true, reasons: [] }], best: { path: 'd1-Q4_K_M.gguf', gb: 1.9, quant: 'Q4_K_M', shards: 1, fits: true, reasons: [] }, downloaded: [] }], budgetGb: 13.5, hubUrl: 'https://huggingface.co/models', counts: { found: 1, shown: 1, hiddenUntrusted: 0, hiddenUnsuitable: 0 } });
      if (p.startsWith('/api/model-manager/')) return json({});
      return route.continue();
    });
    await page.goto(`http://localhost:${PORT}`);
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const manager = page.locator('.model-manager-page');
    await openModelsTab(manager, 'Discover');
    await manager.getByRole('button', { name: /synthetic\/d1-3B-GGUF/ }).first().click();
    const rows = manager.locator('table.mm-table tbody tr');
    await rows.first().waitFor({ timeout: 5000 });
    const cell = async i => (await rows.nth(i).locator('td').nth(3).innerText()).replace(/\s+/g, ' ');
    await check('#1159 a file with a reason shows the reason, not the bare text', async () => {
      const est = await cell(0);
      assert.ok(est.includes('hybrid model whose attention_head_count_kv marks non-attention layers with 0'), 'reason shown: ' + est);
      assert.doesNotMatch(est, /No context estimate for this file/);
      assert.match(est, /Trained for 32,768/);
    });
    await check('#1159 a file without a reason keeps the bare text', async () => {
      const est = await cell(1);
      assert.match(est, /No context estimate for this file/);
    });
  } finally { await browser.close(); await fixture.close?.(); }
  if (problems.length) { console.log(problems.length + ' problem(s)'); process.exitCode = 1; } else console.log('PASS models-discover-estimate-reason-1159');
})().catch(e => { console.error(e); process.exitCode = 1; });
