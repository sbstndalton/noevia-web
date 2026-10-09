// #1158 / #1159 / #1160 — Models & routing, synthetic model-manager APIs only (no model runs).
//  #1158: Context size -1 is refused inline (no request sent); a refusal that carries a code is not
//         reported as "the settings file changed"; a plain 409 still is.
//  #1159: the Discover file table labels each Fit pill with its backend and says when there is no
//         context estimate, instead of two identical unlabelled pills and a bare dash.
//  #1160: the pause confirmations ask the person to stop Diary jobs first; they do not claim it was done.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings, openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const PORT = Number(process.env.QA_PORT || 31180);
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
        { shardBase: 'd1-Q4_K_M.gguf', shards: null, bytes: 2e9, size: '1.9 GiB', quant: 'Q4_K_M', projector: false, fit: [{ name: 'vulkan-0', verdict: 'fits', ratio_pct: 20 }, { name: 'cpu-ram', verdict: 'fits', ratio_pct: 10 }], files: [{ path: 'd1-Q4_K_M.gguf', bytes: 2e9, size: '1.9 GiB' }], estimates: [], nativeCtx: 32768 }] });
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

    // #1159
    await check('#1159 Discover file table: labelled Fit pills and an explained missing estimate', async () => {
      await openModelsTab(manager, 'Discover');
      await manager.getByRole('button', { name: /synthetic\/d1-3B-GGUF/ }).first().click();
      const row = manager.locator('table.mm-table tbody tr').first();
      await row.waitFor({ timeout: 5000 });
      const pills = (await row.locator('.mm-pill').allInnerTexts()).map(s => s.trim());
      assert.equal(pills.length, 2);
      assert.notEqual(pills[0], pills[1], 'pills differ: ' + pills.join(' | '));
      assert.ok(pills.every(s => /vulkan-0|cpu-ram/.test(s)), 'each pill names its backend: ' + pills.join(' | '));
      const est = (await row.locator('td').nth(3).innerText()).replace(/\s+/g, ' ');
      assert.match(est, /No context estimate/);
      assert.match(est, /Trained for 32,768/);
    });

    // #1158 and #1160
    await openModelsTab(manager, 'Your models');
    await manager.getByRole('article', { name: NAME }).getByRole('button', { name: 'Tune' }).click();
    await check('#1160 the auto-tune confirmation asks, it does not claim', async () => {
      const text = (await page.locator('.mm-easy-autotune .mm-check').first().innerText()).replace(/\s+/g, ' ');
      assert.doesNotMatch(text, /I have stopped/);
      assert.match(text, /Stop Diary background jobs and other programs that use the model server first/);
      assert.match(text, /tick this box/);
    });
    await check('#1160 the calibration confirmation asks, it does not claim', async () => {
      const labels = await page.locator('.native-profile-confirm').evaluateAll(els => els.map(e => e.textContent));
      const text = labels.join(' ').replace(/\s+/g, ' ');
      assert.ok(labels.length > 0, 'calibration panel present');
      assert.doesNotMatch(text, /I have stopped/);
      assert.match(text, /Stop Diary background jobs/);
    });
    await manager.getByText('All engine settings (advanced)').click();
    const ctx = manager.getByLabel('Context size', { exact: true });
    const save = manager.getByRole('button', { name: 'Save settings' });
    await check('#1158 -1 is refused inline and Save sends nothing', async () => {
      await ctx.waitFor();
      await ctx.fill('-1');
      await manager.getByRole('alert').filter({ hasText: /whole number, or 0/ }).waitFor({ timeout: 3000 });
      assert.equal(await ctx.getAttribute('aria-invalid'), 'true');
      assert.equal(await save.isDisabled(), true);
      await save.click({ force: true });
      await page.waitForTimeout(300);
      assert.equal(puts.length, 0, 'no PUT was sent');
      await ctx.fill('1.5'); assert.equal(await save.isDisabled(), true);
      await ctx.fill('abc'); assert.equal(await save.isDisabled(), true);
    });
    await check('#1158 0 and a positive whole number are accepted', async () => {
      for (const v of ['0', '8192', '+4096', '']) {
        await ctx.fill(v);
        assert.equal(await manager.getByRole('alert').filter({ hasText: /whole number, or 0/ }).count(), 0, v);
        assert.equal(await save.isEnabled(), true, v);
      }
    });
    await check('#1158 a real revision conflict still says the file changed', async () => {
      await ctx.fill('8192'); putMode = 'conflict';
      await save.click();
      await manager.getByText(/The settings file changed since you opened it/).waitFor({ timeout: 3000 });
    });
    await check('#1158 a coded refusal is shown as itself, not as a conflict', async () => {
      await manager.getByRole('button', { name: 'Reload latest' }).click();
      await ctx.fill('999999'); putMode = 'budget';
      await save.click();
      await manager.getByText(/above the 16 GiB inference memory budget/).waitFor({ timeout: 3000 });
      assert.equal(await manager.getByText(/The settings file changed since you opened it/).count(), 0);
    });
  } finally { await browser.close(); await fixture.close?.(); }
  if (problems.length) { console.log(problems.length + ' problem(s)'); process.exitCode = 1; } else console.log('PASS models-tune-discover-1158-1159-1160');
})().catch(e => { console.error(e); process.exitCode = 1; });
