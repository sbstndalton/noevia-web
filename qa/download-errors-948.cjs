// #948 (Models -> Discover/Download):
//  (1) Hugging Face token Save / Save and test / Remove: a model-manager 500 must show a role="alert"
//      with the server's message and keep the typed token in the field;
//  (2) Cancel on a running download and "Clear finished": a 500 must show a role="alert".
// Offline: synthetic model-manager and engine APIs only. Fails on a build without the fix.
//   npm run build -- --outDir /tmp/dl-948-dist
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Brave or Chrome binary> QA_DIST=/tmp/dl-948-dist node qa/download-errors-948.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const { openSettings } = require('./nav.cjs');

const PORT = Number(process.env.QA_PORT || 31948);
(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS download-errors-948: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL download-errors-948: ${name}\n  ${String(e.message).split('\n').slice(0, 3).join('\n  ')}`); }
  };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const user = { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true };
    const installed = [{ name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, maxContext: 131072, source: 'cache', canDelete: true, status: 'loaded' }];
    const job = (id, filename, status) => ({ id, repo: 'synthetic/repo', filename, status, error: null, bytes: 1e9, downloaded: status === 'done' ? 1e9 : 1e8, pct: status === 'done' ? 100 : 10, speedH: '5 MB/s', etaH: '3 min', parallel: false, chunks: [] });
    const jobs = [job('j-run', 'running-Q4_K_M.gguf', 'downloading'), job('j-done', 'finished-Q4_K_M.gguf', 'done')];
    const hits = { put: 0, cancel: 0, clear: 0 };

    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles: {}, missing: [] });
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json({}) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: [], unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/models', exists: true, disk: { total: 1e11, free: 5e10, usedPct: 50, totalH: '100 GB', freeH: '50 GB' } }, models: 1, sections: 1, backends: [], activeDownloads: 1, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      if (r === 'download-targets') return json({ targets: [] });
      if (r === 'settings' && m === 'GET') return json({ hasToken: true, tokenHint: '…abcd' });
      if (r === 'settings' && m === 'PUT') { hits.put += 1; return json({ error: 'Synthetic settings store failure' }, 500); }
      if (r === 'downloads' && m === 'GET') return json({ jobs });
      if (r === 'downloads/j-run/cancel') { hits.cancel += 1; return json({ error: 'Synthetic cancel failure' }, 500); }
      if (r === 'downloads/clear') { hits.clear += 1; return json({ error: 'Synthetic clear failure' }, 500); }
      if (r.startsWith('search')) return json({ results: [], counts: { found: 0, shown: 0, hiddenUntrusted: 0, hiddenUnsuitable: 0 } });
      return json({});
    });

    await page.goto(`http://localhost:${PORT}`);
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const dialog = page.locator('.model-manager-page');
    await dialog.waitFor();
    await dialog.getByRole('tab', { name: 'Discover', exact: true }).click();

    await check('#948 (1) a failed token Save / Save and test / Remove shows an alert and keeps the typed token', async () => {
      await dialog.locator('summary', { hasText: 'Hugging Face token' }).click();
      const input = dialog.getByLabel('Token', { exact: true });
      await input.fill('hf_synthetic_typed_token');
      for (const [label, expected] of [['Save', 1], ['Save and test', 2], ['Remove token', 3]]) {
        await dialog.getByRole('button', { name: label, exact: true }).click();
        const alert = dialog.locator('.mm-form').getByRole('alert').filter({ hasText: 'Synthetic settings store failure' });
        await alert.waitFor({ timeout: 3000 });
        assert.equal(hits.put, expected, `${label}: one PUT reached the server`);
        assert.equal(await input.inputValue(), 'hf_synthetic_typed_token', `${label}: the typed token is kept`);
        // A retry clears the stale alert before the next attempt resolves.
      }
    });

    await check('#948 (2) a failed Cancel shows an alert', async () => {
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Synthetic cancel failure' }).waitFor({ timeout: 3000 });
      assert.equal(hits.cancel, 1);
    });

    await check('#948 (2) a failed Clear finished shows an alert', async () => {
      await dialog.getByRole('button', { name: 'Clear finished', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Synthetic clear failure' }).waitFor({ timeout: 3000 });
      assert.equal(hits.clear, 1);
    });

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`download-errors-948: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
