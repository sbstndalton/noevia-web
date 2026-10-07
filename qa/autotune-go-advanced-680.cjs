// #680: "Go to Auto-tune and apply" must work while the settings editor is in Advanced mode.
// Synthetic model/API fixtures only; no tune is ever started (any POST fails the run).
// QA_DIST serves a build elsewhere; QA_SCREENSHOTS is the screenshot directory.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings } = require('./nav.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const OUT = process.env.QA_SCREENSHOTS || '/tmp';
const NAME = 'Synthetic-9B-Q5';
const schema = [{ tier: 'Common', open: true, fields: [{ key: 'model', label: 'Model file', kind: 'text', choices: [], placeholder: '', help: '' }, { key: 'ctx-size', label: 'Context size', kind: 'int', choices: [], placeholder: '8192', help: '' }] }];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = createFixture(31680); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let failed = null;
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors = [], posts = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem('noevia:model-settings-mode', 'advanced'));
      await page.route('**/api/**', route => {
        const req = route.request(), u = new URL(req.url()), p = u.pathname;
        const json = (body, status = 200) => route.fulfill({ json: body, status });
        if (req.method() !== 'GET') posts.push(req.method() + ' ' + p);
        if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true });
        if (p === '/api/models/installed') return json([{ name: NAME, loaded: true, labels: [], sizeGB: 6.6, status: 'loaded' }]);
        if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: NAME, smart: NAME, vision: NAME }, missing: [] });
        if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
        if (p === '/api/models/estimate') return json({ model: NAME, budgetGib: null, chat: true, sizeable: true, arch: 'qwen35', nativeCtx: 262144, modelGib: 6.15, pinnedGib: 0, reserveGib: 1, safety: 1.05, moe: false, rows: [], current: { ctx: 16384, kv: 'q8_0' } });
        if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [] });
        if (p === '/api/models/autotune') return json({ job: { id: 't9', model: NAME, status: 'failed', phase: 'KV cache', error: 'Synthetic failure.', models: [{ model: NAME, status: 'failed', phases: [] }] }, history: [] });
        if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
        if (p === '/api/models/calibration') return json({ job: null, history: [] });
        if (p === '/api/model-manager/sections') return json({ revision: 'r1', schema, sections: [{ name: NAME, items: [['ctx-size', '16384']], hasFile: true, file: 'q/x.gguf', cli: 'llama-server' }], unregistered: [], backups: [] });
        if (p.startsWith('/api/model-manager/sections/') && p.endsWith('/autoconfig')) return json({});
        if (p.startsWith('/api/model-manager/sections/')) return json({ name: NAME, exists: true, values: { model: '/models/q/x.gguf', 'ctx-size': '16384' }, extras: '', hints: [], revision: 'r1', schema });
        if (p === '/api/model-manager/downloads') return json({ jobs: [] });
        if (p.startsWith('/api/model-manager/')) return json({});
        return route.continue();
      });
      await page.goto('http://localhost:31680');
      await openSettings(page);
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await settings.getByRole('button', { name: 'Models & routing' }).click();
      await settings.getByRole('button', { name: 'Open model manager' }).click();
      const manager = page.locator('.model-manager-page');
      await manager.getByRole('tab', { name: 'Your models', exact: true }).click();
      await manager.getByRole('article', { name: NAME }).getByRole('button', { name: 'Tune' }).click();
      await manager.getByRole('button', { name: 'Advanced', exact: true }).waitFor();
      assert.equal(await manager.getByRole('button', { name: 'Advanced', exact: true }).getAttribute('aria-pressed'), 'true', 'starts in Advanced');
      assert.equal(await page.locator('.mm-easy-autotune').count(), 0, 'no Auto-tune panel in Advanced');
      await manager.getByRole('button', { name: 'Go to Auto-tune and apply' }).click();
      const panel = page.locator('.mm-easy-autotune');
      try {
        await panel.waitFor({ state: 'visible', timeout: 3000 });
        const summary = panel.locator(':scope > summary');
        await page.waitForFunction(() => document.activeElement?.matches('.mm-easy-autotune > summary'), null, { timeout: 3000 });
        assert.ok(await panel.evaluate(el => el.open), 'panel open');
        const box = await summary.boundingBox();
        assert.ok(box && box.y >= 0 && box.y + box.height <= 800, 'panel heading in view: ' + JSON.stringify(box));
        assert.equal(await manager.getByRole('button', { name: 'Easy', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => localStorage.getItem('noevia:model-settings-mode')), 'advanced', 'saved preference untouched');
        assert.deepEqual(posts.filter(x => /autotune|calibration/.test(x)), [], 'no tune started: ' + posts.join(', '));
        assert.deepEqual(errors, []);
        await page.screenshot({ path: `${OUT}/go-autotune-advanced-${width}.png` });
        console.log(`PASS ${width}px`);
      } catch (e) { failed = e; console.log(`FAIL ${width}px: ${String(e.message).split('\n')[0]}`); }
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
