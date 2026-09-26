// #421 (P2): every model card's Load/Tune/Details/Delete (and Unload) buttons used to share the
// same generic, unlabelled accessible name across every installed model — a screen reader or
// switch-access user navigating a flat list of buttons could not tell which model a "Load" or,
// worse, a destructive "Delete" acted on. Offline: synthetic model-manager APIs, two installed
// models, no inference/storage/network.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(31474);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS model-card-labels: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const installed = [
      { name: 'Fast-Model', labels: [], loaded: true, sizeGB: 4, maxContext: 32768, source: 'cache', canDelete: true, status: 'loaded' },
      { name: 'Smart-Model', labels: [], loaded: false, sizeGB: 6, maxContext: 32768, source: 'cache', canDelete: true, status: 'unloaded' },
    ];
    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles: {}, missing: [] });
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: installed.map((mo) => ({ key: `f/${mo.name}.gguf`, name: `${mo.name}.gguf`, subdir: 'f', bytes: mo.sizeGB * 1e9, size: `${mo.sizeGB.toFixed(1)} GB`, modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [mo.name], modelId: mo.name, file: `f/${mo.name}.gguf`, shape: null, loadedOn: [], fit: [], badges: [] })), unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/models', exists: true, disk: { total: 1e11, free: 5e10, usedPct: 50, totalH: '100 GB', freeH: '50 GB' } }, models: installed.length, sections: installed.length, backends: [], activeDownloads: 0, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      return json({});
    });

    await page.goto('http://localhost:31474');
    await page.getByTitle('Settings', { exact: true }).click();
    const settings = page.getByRole('region', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const dialog = page.locator('.model-manager-page');
    await dialog.waitFor();
    await dialog.getByRole('tab', { name: 'Your models', exact: true }).click();
    await dialog.getByRole('article', { name: 'Fast-Model' }).waitFor();
    await dialog.getByRole('article', { name: 'Smart-Model' }).waitFor();

    // Each action button's own accessible name must resolve to exactly one button across both
    // cards — the practical, AT-navigation consequence of a name that actually names the model.
    // Fast-Model is loaded (so it offers Unload); Smart-Model is not (so it offers Load).
    const named = [
      ['Unload Fast-Model', 'Fast-Model'],
      ['Load Smart-Model', 'Smart-Model'],
      ['Tune Fast-Model', 'Fast-Model'],
      ['Tune Smart-Model', 'Smart-Model'],
      ['Details for Fast-Model', 'Fast-Model'],
      ['Details for Smart-Model', 'Smart-Model'],
      ['Delete Fast-Model', 'Fast-Model'],
      ['Delete Smart-Model', 'Smart-Model'],
    ];
    for (const [label, cardName] of named) {
      const button = dialog.getByRole('button', { name: label, exact: true });
      assert.equal(await button.count(), 1, `"${label}" must resolve to exactly one button`);
      // ...and it must be the button inside the RIGHT card, not merely present somewhere.
      assert.equal(await dialog.getByRole('article', { name: cardName }).getByRole('button', { name: label, exact: true }).count(), 1,
        `"${label}" must live inside the ${cardName} card`);
    }
    pass('Load/Unload, Tune, Details and Delete each carry the model name, resolving to exactly one button per card');

    // The old, bare labels must no longer be the WHOLE accessible name of more than zero buttons
    // — every actionable button now names its model.
    for (const bare of ['Load', 'Unload', 'Tune', 'Details', 'Delete']) {
      const count = await dialog.getByRole('button', { name: bare, exact: true }).count();
      assert.equal(count, 0, `no button's accessible name should still be the bare, ambiguous "${bare}"`);
    }
    pass('no action button\'s accessible name is still the bare, ambiguous verb alone');

    // Expanding "Details" toggles its own name too (Details for X <-> Hide details for X), not
    // just its visible text.
    await dialog.getByRole('article', { name: 'Fast-Model' }).getByRole('button', { name: 'Details for Fast-Model', exact: true }).click();
    await dialog.getByRole('article', { name: 'Fast-Model' }).getByRole('button', { name: 'Hide details for Fast-Model', exact: true }).waitFor();
    pass('the Details button\'s accessible name tracks its own open/closed state, still naming the model');

    assert.deepEqual(errors, []);
    console.log(`PASS model-card-labels: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
