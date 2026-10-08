// #1088 browser proof. Synthetic fixtures only: no real models, inference or storage.
// The server could not read the folder scan for the installed list (loader slow), so every row
// that is not loaded arrives with sizeGB: null; the page's own scan (/api/model-manager/models)
// still has the files. The cards must show the size from that scan, in the same decimal GB, and
// a model with neither source shows no size. Fails against the pre-fix UI (no size on the cards).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openSettings, openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(31485);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS models-size-fallback-1088: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const installed = [
      { name: 'synthetic-loaded-12b', labels: [], loaded: true, sizeGB: 7, source: 'preset', canDelete: true, status: 'loaded' },
      { name: 'synthetic-unloaded-4b', labels: [], loaded: false, sizeGB: null, shape: null, source: 'preset', canDelete: true, status: 'unloaded' },
      { name: 'synthetic-unloaded-9b', labels: [], loaded: false, sizeGB: null, shape: null, source: 'preset', canDelete: true, status: 'unloaded' },
      { name: 'synthetic-cache-only', labels: [], loaded: false, sizeGB: null, shape: null, source: 'cache', canDelete: true, status: 'unloaded' },
    ];
    const file = (name, bytes) => ({ key: `${name}/${name}.gguf`, name: `${name}.gguf`, stem: name, subdir: name, bytes, size: 'x', modified: '2026-10-01 10:00', sharded: false, parts: 1, companion: false, projector: null, sections: [name], modelId: name, file: `${name}/${name}.gguf`, shape: { arch: 'x', moe: false, experts: 0, active: 0, label: 'dense' }, loadedOn: [], fit: [], badges: [] });
    const files = [file('synthetic-unloaded-4b', 3_349_516_256), file('synthetic-unloaded-9b', 6_135_034_208)];
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
      if (p === '/api/model-manager/models') return json({ models: files, unregistered: [], revision: 'r1' });
      if (p === '/api/model-manager/models/updates') return json({ status: {} });
      if (p.startsWith('/api/model-manager/')) return json({});
      if (p.startsWith('/api/models/')) return json({});
      return route.continue();
    });

    await page.goto('http://localhost:31485');
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const manager = page.locator('.model-manager-page');
    await manager.waitFor();
    await openModelsTab(manager, 'Your models');
    const card = (name) => manager.getByRole('article', { name });

    const meta = async (name) => { const c = card(name); await c.waitFor(); return c.locator('.model-card-meta').first().innerText(); };
    assert.match(await meta('synthetic-unloaded-4b'), /3\.3/, 'the 4b card shows the size from the page scan');
    assert.match(await meta('synthetic-unloaded-9b'), /6\.1/, 'the 9b card shows the size from the page scan');
    pass('unloaded models with no server size show the size from the page scan');
    assert.match(await meta('synthetic-loaded-12b'), /7/, 'a row that has a server size keeps it');
    assert.doesNotMatch(await meta('synthetic-cache-only'), /\d\s*GB/, 'no scan entry and no server size: no size is invented');
    pass('server size wins; a model with no size anywhere shows none');

    assert.deepEqual(errors, []);
    console.log(`PASS models-size-fallback-1088: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
