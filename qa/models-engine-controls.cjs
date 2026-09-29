// #545 / #548 / #551 browser proof. Synthetic fixtures only: no real models, inference or storage.
//  - #548: Laya and the in-use embedding/reranker models (sidecarProtected) have no Load/Unload.
//  - #545: a preset whose model file is missing is shown as failed, with no Load/Tune, and is not
//    offered as a chat model in the composer picker or the role pickers.
//  - #551: Overview > Recover shows no Resume for a failed auto-tune of a model that is no longer installed.
// Fails against the pre-fix UI (Load/Unload was unconditional; Recover offered Resume).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(31475);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS models-engine-controls: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const installed = [
      { name: 'Synthetic-7B', labels: [], loaded: false, sizeGB: 4, source: 'preset', canDelete: true, status: 'unloaded' },
      { name: 'laya_multilingual_f16', labels: [], loaded: false, sizeGB: 0, source: 'preset', canDelete: true, status: 'missing', failed: true, missingFile: true },
      { name: 'synthetic-embed-v1', labels: ['embedding'], loaded: false, sizeGB: 0.3, source: 'preset', canDelete: true, status: 'unloaded', sidecarProtected: true },
      { name: 'synthetic-reranker-0.6b', labels: ['reranking'], loaded: true, sizeGB: 0.6, source: 'preset', canDelete: true, status: 'loaded', sidecarProtected: true },
      { name: 'Ghost-13B', labels: [], loaded: false, sizeGB: 0, source: 'preset', canDelete: true, status: 'missing', failed: true, missingFile: true },
    ];
    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/auto-roles' && req.method() === 'GET') return json({ configured: true, roles: { fast: 'Synthetic-7B', smart: 'Synthetic-7B' }, missing: [] });
      // A failed run for a model that is not installed (#551).
      if (p === '/api/models/autotune') return json({ job: { id: 't9', model: 'synthetic-20b-Q4_K_M', status: 'failed', phase: 'KV cache', error: 'No KV cache type passed quality and throughput checks.', models: [{ model: 'synthetic-20b-Q4_K_M', status: 'failed', phases: [] }] }, history: [] });
      if (p === '/api/models/calibration') return json({ job: null, history: [] });
      if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
      if (p === '/api/model-manager/downloads') return json({ jobs: [] });
      if (p === '/api/model-manager/backends') return json({ backends: [] });
      if (p === '/api/model-manager/models') return json({ models: [], unregistered: [] });
      if (p === '/api/model-manager/models/updates') return json({ status: {} });
      if (p === '/api/model-manager/overview') return json({});
      if (p.startsWith('/api/model-manager/')) return json({});
      if (p.startsWith('/api/models/')) return json({});
      return route.continue();
    });

    await page.goto('http://localhost:31475');
    await openSettings(page);
    const settings = page.getByRole('region', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const manager = page.locator('.model-manager-page');
    await manager.waitFor();

    // #551 first: Overview is the default tab.
    await manager.getByRole('tab', { name: 'Overview' }).click();
    await manager.getByRole('heading', { name: 'Recover' }).waitFor();
    await manager.getByText('No failed or stuck tuning, calibration or download jobs.').waitFor();
    assert.equal(await manager.getByText('synthetic-20b-Q4_K_M').count(), 0, 'the uninstalled model\'s failed run is not listed');
    assert.equal(await manager.getByRole('button', { name: 'Resume', exact: true }).count(), 0, 'no Resume for an uninstalled model');
    pass('Recover shows no Resume for a failed auto-tune of an uninstalled model (#551)');

    await manager.getByRole('tab', { name: 'Your models', exact: true }).click();
    const card = (name) => manager.getByRole('article', { name });
    await card('Synthetic-7B').waitFor();
    assert.equal(await card('Synthetic-7B').getByRole('button', { name: 'Load Synthetic-7B', exact: true }).count(), 1, 'an ordinary model keeps Load');

    for (const name of ['laya_multilingual_f16', 'synthetic-embed-v1', 'synthetic-reranker-0.6b']) {
      const c = card(name);
      await c.waitFor();
      assert.equal(await c.getByRole('button', { name: new RegExp(`^(Load|Unload) ${name}$`) }).count(), 0, `${name} offers no Load/Unload`);
    }
    pass('Laya and the protected embedding/reranker models have no Load/Unload (#548)');

    const ghost = card('Ghost-13B');
    await ghost.waitFor();
    assert.equal(await ghost.getByRole('button', { name: /^(Load|Unload|Tune) Ghost-13B$/ }).count(), 0, 'a missing-file preset offers no Load/Tune');
    assert.equal(await ghost.getAttribute('data-state'), 'failed', 'a missing-file preset reads as failed');
    await ghost.getByRole('button', { name: 'Details for Ghost-13B', exact: true }).click();
    await ghost.getByText(/not in the models folder/).waitFor();
    pass('a preset whose model file is missing is shown as failed, without Load or Tune (#545)');

    assert.deepEqual(errors, []);
    console.log(`PASS models-engine-controls: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
