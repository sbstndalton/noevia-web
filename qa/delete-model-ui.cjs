// Regression for #302: deleting a model from Library must remove its card immediately (no
// reload), fire noevia:models-changed, and — when the server reports a cleared auto-role —
// show a short status line naming it. Synthetic model-manager and engine APIs only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const shots = process.env.QA_SCREENSHOTS || '/tmp/delmodel-shots';
require('node:fs').mkdirSync(shots, { recursive: true });

(async () => {
  const fixture = createFixture(31347);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    let deletedNames = [];
    let installed = [
      { name: 'Fast-Model', labels: [], loaded: true, sizeGB: 4, maxContext: 32768, source: 'cache', canDelete: true, status: 'loaded' },
      { name: 'Smart-Model', labels: [], loaded: false, sizeGB: 6, maxContext: 32768, source: 'cache', canDelete: true, status: 'unloaded' },
      // Folder-configured (source: 'preset'): LibraryTab's DeleteModel routes this through the
      // /api/model-manager/models/delete proxy instead of /api/models/delete (#302 follow-up —
      // the proxy path was left unfixed while only the direct route got the unload/roles
      // cleanup, so most real llama.cpp models — folder models — stayed broken).
      { name: 'Folder-Model', labels: [], loaded: true, sizeGB: 3, maxContext: 32768, source: 'preset', canDelete: false, status: 'loaded' },
    ];
    let roles = { fast: 'Fast-Model', smart: 'Smart-Model', code: 'Folder-Model' };
    let deleteCalls = 0, proxyDeleteCalls = 0;

    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      const body = () => { try { return req.postDataJSON(); } catch { return {}; } };
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed.filter((mo) => !deletedNames.includes(mo.name)));
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles, missing: [] });
      if (p === '/api/models/delete' && m === 'POST') {
        deleteCalls += 1;
        const name = body().name;
        deletedNames.push(name);
        const rolesCleared = [];
        for (const role of ['fast', 'smart', 'vision', 'code']) if (roles[role] === name) { rolesCleared.push(role); delete roles[role]; }
        return json({ ok: true, unloaded: true, rolesCleared });
      }
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models/delete' && m === 'POST') {
        proxyDeleteCalls += 1;
        const key = body().models[0];
        const mo = installed.find((x) => `f/${x.name}.gguf` === key);
        const name = mo?.name;
        if (name) deletedNames.push(name);
        const rolesCleared = [];
        if (name) for (const role of ['fast', 'smart', 'vision', 'code']) if (roles[role] === name) { rolesCleared.push(role); delete roles[role]; }
        return json({ results: [{ key, ok: true, message: 'deleted', freed: 3e9, freedH: '3.0 GB' }], unloaded: true, rolesCleared });
      }
      if (r === 'models') return json({ models: installed.filter((mo) => !deletedNames.includes(mo.name)).map((mo) => ({ key: `f/${mo.name}.gguf`, name: `${mo.name}.gguf`, subdir: 'f', bytes: mo.sizeGB * 1e9, size: `${mo.sizeGB.toFixed(1)} GB`, modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [mo.name], modelId: mo.name, file: `f/${mo.name}.gguf`, shape: null, loadedOn: [], fit: [], badges: [] })), unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/models', exists: true, disk: { total: 1e11, free: 5e10, usedPct: 50, totalH: '100 GB', freeH: '50 GB' } }, models: installed.length, sections: installed.length, backends: [], activeDownloads: 0, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      return json({});
    });

    await page.goto('http://localhost:31347');
    await page.getByTitle('Settings', { exact: true }).click();
    const settings = page.getByRole('region', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const dialog = page.locator('.model-manager-page');
    await dialog.waitFor();
    await dialog.getByRole('tab', { name: 'Your models', exact: true }).click();
    await dialog.getByRole('article', { name: 'Fast-Model' }).waitFor();
    await dialog.getByRole('article', { name: 'Smart-Model' }).waitFor();

    for (const [width, label] of [[375, '375'], [1440, '1440']]) {
      await page.setViewportSize({ width, height: 950 });
      await page.screenshot({ path: `${shots}/delmodel-before-${label}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 950 });

    // Listen for the real dispatch before triggering the delete, so this is a genuine
    // observation of the app's own event rather than a synthetic one fired afterwards.
    await page.evaluate(() => {
      window.__modelsChangedFired = false;
      window.addEventListener('noevia:models-changed', () => { window.__modelsChangedFired = true; }, { once: true });
    });

    const card = dialog.getByRole('article', { name: 'Fast-Model' });
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await card.getByRole('button', { name: 'Delete files' }).click();

    // The card must be gone WITHOUT a reload: wait only long enough to observe it, and assert
    // there was exactly one delete call (no polling loop retried it).
    await dialog.getByRole('article', { name: 'Fast-Model' }).waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(deleteCalls, 1, 'exactly one delete call reached the server');
    assert.ok(await dialog.getByRole('article', { name: 'Smart-Model' }).isVisible(), 'the other card is untouched');

    // The cleared "fast" role is reported back and shown.
    await dialog.getByText(/Also cleared from auto-routing: Fast/).waitFor();

    assert.equal(await page.evaluate(() => window.__modelsChangedFired), true, 'noevia:models-changed did not fire on delete');

    // A folder-configured (source: 'preset') model deletes through the
    // /api/model-manager/models/delete proxy, not /api/models/delete — and must get the same
    // treatment: card gone without reload, exactly one proxy delete call, cleared role reported.
    await page.evaluate(() => {
      window.__modelsChangedFired = false;
      window.addEventListener('noevia:models-changed', () => { window.__modelsChangedFired = true; }, { once: true });
    });
    const folderCard = dialog.getByRole('article', { name: 'Folder-Model' });
    await folderCard.waitFor();
    await folderCard.getByRole('button', { name: 'Delete', exact: true }).click();
    await folderCard.getByRole('button', { name: 'Delete files' }).click();
    await dialog.getByRole('article', { name: 'Folder-Model' }).waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(proxyDeleteCalls, 1, 'exactly one proxy delete call reached the server for the folder model');
    assert.equal(deleteCalls, 1, 'the folder model never went through the direct /api/models/delete route');
    await dialog.getByText(/Also cleared from auto-routing: Code/).waitFor();
    assert.equal(await page.evaluate(() => window.__modelsChangedFired), true, 'noevia:models-changed did not fire for the folder-model delete');

    for (const [width, label] of [[375, '375'], [1440, '1440']]) {
      await page.setViewportSize({ width, height: 950 });
      await page.screenshot({ path: `${shots}/delmodel-after-${label}.png` });
    }

    assert.deepEqual(errors, []);
    assert.equal(fixture.requests.length, 0);
    console.log('PASS delete-model-ui: the card disappears without reload, exactly one delete call fires, the cleared role is reported, and noevia:models-changed is live.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
