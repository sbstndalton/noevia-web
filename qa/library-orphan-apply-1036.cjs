// #1036: a file whose models.ini section is saved but not served yet says so and offers Apply.
// Synthetic model-manager and engine APIs only; fails on a build without the Apply control.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/sebastiandalton/noevia-local-test/node_modules/playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openSettings } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const OUT = process.env.QA_SCREENSHOTS || '/tmp';
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${process.env.QA_TAG || 'run'}-${name}.png`) });
(async () => {
  const fixture = createFixture(31436); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true }));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [], reloads = []; let served = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (body, status = 200) => route.fulfill({ status, json: body });
      const body = () => { try { return req.postDataJSON() || {}; } catch { return {}; } };
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json([{ name: 'Qwen-9B', labels: [], loaded: true, sizeGB: 5.6, maxContext: 8192, source: 'preset', canDelete: false, status: 'loaded' },
        ...(served ? [{ name: 'fresh-model', labels: [], loaded: false, sizeGB: 2, maxContext: 8192, source: 'preset', canDelete: false, status: 'unloaded' }] : [])]);
      if (p === '/api/models/presets/reload') { const b = body(); reloads.push(b); if (!b.unload) return json({ error: 'A model is loaded.', loaded: ['Qwen-9B'] }, 409); served = true; return json({ reloaded: true, unloaded: ['Qwen-9B'] }); }
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: [
        { key: 'q/Qwen-9B.gguf', name: 'Qwen-9B.gguf', subdir: 'q', bytes: 5.6e9, size: '5.6 GB', modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: ['Qwen-9B'], modelId: 'Qwen-9B', file: 'q/Qwen-9B.gguf', shape: null, loadedOn: ['e'], fit: [], badges: [] },
        { key: 'f/fresh-model.gguf', name: 'fresh-model.gguf', subdir: 'f', bytes: 2e9, size: '2.0 GB', modified: '2026-10-07', sharded: false, parts: 1, projector: null, sections: ['fresh-model'], modelId: 'fresh-model', file: 'f/fresh-model.gguf', shape: null, loadedOn: [], fit: [], badges: [] },
        { key: 'n/bare.gguf', name: 'bare.gguf', subdir: 'n', bytes: 1e9, size: '1.0 GB', modified: '2026-10-07', sharded: false, parts: 1, projector: null, sections: [], modelId: 'bare', file: 'n/bare.gguf', shape: null, loadedOn: [], fit: [], badges: [] },
      ], unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/m', exists: true, disk: { total: 5e11, free: 1.5e11, usedPct: 70, totalH: '465 GB', freeH: '139 GB' } }, models: 3, sections: 2, backends: [], activeDownloads: 0, revision: 'r1' });
      if (r === 'sections' && m === 'GET') return json({ revision: 'r1', schema: [], sections: [], unregistered: [], backups: [], raw: '' });
      if (r === 'backends') return json({ backends: [] });
      return json({});
    });
    await page.goto('http://localhost:31436');
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const dialog = page.locator('.model-manager-page'); await dialog.waitFor();
    await dialog.getByText('Files without a model entry').waitFor();
    // Only the file with a saved section gets the note and Apply; a bare file keeps Create settings.
    await shot(page, 'orphan-list');
    const saved = dialog.getByText('Saved; the engine offers it after its next reload.');
    await saved.waitFor({ timeout: 5000 });
    assert.equal(await saved.count(), 1);
    assert.equal(await dialog.getByRole('button', { name: 'Create settings' }).count(), 1);
    // Apply with no unload: the engine refuses (a model is loaded) -> the unload-to-apply prompt.
    await dialog.getByRole('button', { name: 'Apply now', exact: true }).click();
    await dialog.getByText(/Qwen-9B is loaded, so the engine keeps the old settings/).waitFor();
    assert.deepEqual(reloads, [{ unload: false }]);
    await shot(page, 'unload-prompt');
    await dialog.getByRole('button', { name: 'Apply now (unloads the model)' }).click();
    await dialog.getByRole('article', { name: 'fresh-model' }).waitFor({ timeout: 5000 });
    assert.deepEqual(reloads, [{ unload: false }, { unload: true }]);
    await shot(page, 'after-apply');
    assert.deepEqual(errors, []);
    console.log('PASS library-orphan-apply-1036');
  } finally { await browser.close(); await fixture.close?.(); }
})().catch(e => { console.error(e); process.exit(1); });
