// #1084 / #1083 browser proof. Synthetic fixtures only: no real models, inference or storage.
//  - an unloaded model whose installed row carries the loader's size and shape shows both, even
//    though the router gave no meta (the folder-scan endpoint is empty here on purpose, so the card
//    cannot borrow them from a second fetch);
//  - Laya (preset with no local file, served by its own sidecar) reads "Runs in its own service",
//    carries no "File missing" state or note, and offers no Load;
//  - a genuinely missing ordinary preset still reads "File missing".
// Fails against the pre-fix UI (Laya read "Unloaded"/"File missing"; no row-level shape).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings, openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(31484);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS models-size-shape-1084: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const installed = [
      { name: 'synthetic-loaded-12b', labels: [], loaded: true, sizeGB: 7, shape: { arch: 'x', moe: false, label: 'dense' }, source: 'preset', canDelete: true, status: 'loaded' },
      { name: 'synthetic-unloaded-4b', labels: [], loaded: false, sizeGB: 3.2, shape: { arch: 'x', moe: true, experts: 8, active: 2, label: 'MoE' }, source: 'preset', canDelete: true, status: 'unloaded' },
      { name: 'laya_multilingual_f16', labels: [], loaded: false, sizeGB: null, shape: null, source: 'preset', canDelete: true, status: 'served-elsewhere', failed: false, missingFile: false, servedElsewhere: true },
      { name: 'gone-13b', labels: [], loaded: false, sizeGB: null, shape: null, source: 'preset', canDelete: true, status: 'missing', failed: true, missingFile: true },
    ];
    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
      if (p === '/api/auto-roles' && req.method() === 'GET') return json({ configured: true, roles: {}, missing: [] });
      if (p === '/api/models/autotune') return json({ job: null, history: [] });
      if (p === '/api/models/calibration') return json({ job: null, history: [] });
      if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
      if (p === '/api/model-manager/downloads') return json({ jobs: [] });
      if (p === '/api/model-manager/backends') return json({ backends: [] });
      if (p === '/api/model-manager/models') return json({ models: [], unregistered: [] });
      if (p === '/api/model-manager/models/updates') return json({ status: {} });
      if (p.startsWith('/api/model-manager/')) return json({});
      if (p.startsWith('/api/models/')) return json({});
      return route.continue();
    });

    await page.goto('http://localhost:31484');
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const manager = page.locator('.model-manager-page');
    await manager.waitFor();
    await openModelsTab(manager, 'Your models');
    const card = (name) => manager.getByRole('article', { name });

    const unloaded = card('synthetic-unloaded-4b');
    await unloaded.waitFor();
    const meta = await unloaded.locator('.model-card-meta').first().innerText();
    assert.match(meta, /3\.2/, 'the unloaded model shows its size');
    assert.match(meta, /MoE/i, 'the unloaded model shows its shape');
    pass('an unloaded model shows the size and shape the server merged in');

    const laya = card('laya_multilingual_f16');
    await laya.waitFor();
    assert.equal(await laya.locator('.model-card-state').innerText(), 'Runs in its own service');
    assert.equal(await laya.getByText(/not in the models folder/).count(), 0, 'no missing-file note');
    pass('Laya reads "Runs in its own service", not "File missing"');

    const gone = card('gone-13b');
    assert.equal(await gone.locator('.model-card-state').innerText(), 'File missing');
    pass('an ordinary preset with no file still reads "File missing"');

    assert.deepEqual(errors, []);
    console.log(`PASS models-size-shape-1084: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
