// #579 browser proof. Synthetic fixtures only: no real models, inference or storage.
// Laya (system model, preset file missing) and an in-use embedding sidecar model:
//  - the card of a missing-file preset reads "File missing" (not "Failed to load") and carries the
//    missing-file note itself;
//  - Details never says "served from the download cache" for them, and shows no chat
//    Qualification evidence or Recheck button;
//  - a plain model that really is a download-cache model keeps the cache line.
// Fails against the pre-fix UI (fromCache always shown, EvidenceList unconditional).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(31476);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS models-details: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const installed = [
      { name: 'laya_multilingual_f16', labels: [], loaded: false, sizeGB: 0, source: 'preset', canDelete: true, status: 'missing', failed: true, missingFile: true },
      { name: 'synthetic-embed-v1', labels: ['embedding'], loaded: true, sizeGB: 0.3, source: 'preset', canDelete: true, status: 'loaded', sidecarProtected: true },
      { name: 'Cached-8B', labels: [], loaded: false, sizeGB: 4, source: 'cache', canDelete: true, status: 'unloaded' },
    ];
    const evidence = { tracked: true, categories: [
      { category: 'context_capacity', state: 'unavailable', value: null, at: null, suite: null, limitations: ['engine or model file not readable'] },
      { category: 'vision', state: 'unavailable', value: null, at: null, suite: null, limitations: ['engine or model file not readable'] },
    ] };
    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/models/evidence') return json(evidence);
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

    await page.goto('http://localhost:31476');
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const manager = page.locator('.model-manager-page');
    await manager.waitFor();
    await manager.getByRole('tab', { name: 'Your models', exact: true }).click();
    const card = (name) => manager.getByRole('article', { name });

    const laya = card('laya_multilingual_f16');
    await laya.waitFor();
    assert.equal(await laya.locator('.model-card-state').innerText(), 'File missing', 'a missing preset does not read "Failed to load"');
    await laya.getByText(/not in the models folder/).waitFor();
    pass('Laya\'s card reads "File missing" and carries the missing-file note');

    await laya.getByRole('button', { name: 'Details for laya_multilingual_f16', exact: true }).click();
    await laya.getByText(/not in the models folder/).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await laya.getByText(/download cache/).count(), 0, 'Laya is not "served from the download cache"');
    assert.equal(await laya.getByText('Qualification', { exact: false }).count(), 0, 'no chat qualification for Laya');
    assert.equal(await laya.getByRole('button', { name: 'Recheck' }).count(), 0, 'no Recheck for Laya');
    pass('Laya Details: missing note, no download-cache line, no qualification, no Recheck');

    const embed = card('synthetic-embed-v1');
    await embed.getByRole('button', { name: 'Details for synthetic-embed-v1', exact: true }).click();
    await embed.getByText(/run by its own service/).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await embed.getByText(/download cache/).count(), 0, 'a sidecar model is not "served from the download cache"');
    assert.equal(await embed.getByText('Qualification', { exact: false }).count(), 0, 'no chat qualification for a sidecar model');
    assert.equal(await embed.getByRole('button', { name: 'Recheck' }).count(), 0, 'no Recheck for a sidecar model');
    assert.equal(await embed.locator('.model-card-state').innerText(), 'Loaded', 'the sidecar model shows its real state');
    pass('sidecar model Details: sidecar source line, no qualification, no Recheck');

    const cached = card('Cached-8B');
    await cached.getByRole('button', { name: 'Details for Cached-8B', exact: true }).click();
    await cached.getByText(/served from the download cache/).waitFor();
    await cached.getByRole('heading', { name: 'Qualification', exact: false }).waitFor();
    pass('a genuine download-cache chat model keeps its cache line and qualification');

    assert.deepEqual(errors, []);
    console.log(`PASS models-details: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
