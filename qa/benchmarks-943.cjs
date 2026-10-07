// #943 (Models -> Benchmarks / Prompts):
//  (5) clearing a benchmark rating whose DELETE fails (500) must show an alert and keep the badge;
//  (6) deleting a saved prompt must ask first: the first Delete click only opens an inline
//      confirmation (no DELETE sent, prompt still listed), Keep cancels, and the confirmed
//      Delete removes it. The Delete button's accessible name names the prompt.
// Offline: synthetic model-manager and engine APIs only. Fails on a build without the fix.
//   npm run build -- --outDir /tmp/bench-943-dist
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Brave or Chrome binary> QA_DIST=/tmp/bench-943-dist node qa/benchmarks-943.cjs
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const {openSettings, openModelsTab } = require('./nav.cjs');

const PORT = Number(process.env.QA_PORT || 31943);
(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS benchmarks-943: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL benchmarks-943: ${name}\n  ${String(e.message).split('\n').slice(0, 3).join('\n  ')}`); }
  };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 950 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const now = Math.floor(Date.now() / 1000);
    const user = { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true };
    const installed = [{ name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, maxContext: 131072, source: 'cache', canDelete: true, status: 'loaded' }];
    let prompts = [{ id: 1, name: 'Synthetic summary', body: 'Summarise this synthetic text.' }, { id: 2, name: 'Synthetic riddle', body: 'Tell a synthetic riddle.' }];
    let badges = [{ alias: 'Synthetic-Chat', category: 'chat', rating: 4, note: '', run_id: 1 }];
    let badgeDeletes = 0, promptDeletes = 0;
    const run = { run: { id: 1, backend: 'llamacpp', status: 'done', started_at: now - 3600, finished_at: now - 3500, reps: 1, max_tokens: 64, note: '' },
      variants: [{ alias: 'Synthetic-Chat', load_ms: 100 }], results: [], sweeps: [],
      charts: { capacity_gb: 0, aliases: ['Synthetic-Chat'], gen: [], ttft: [], vram_labels: [], vram_measured: [], vram_predicted: [] } };

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
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/models', exists: true, disk: { total: 1e11, free: 5e10, usedPct: 50, totalH: '100 GB', freeH: '50 GB' } }, models: 1, sections: 1, backends: [], activeDownloads: 0, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      if (r === 'benchmark') return json({ sections: ['Synthetic-Chat'], sweepArgs: {}, prompts, backends: ['llamacpp'], maxTokensDefault: 256, maxTokensCeiling: 1024, categories: [{ key: 'chat', label: 'Chat' }],
        job: { run_id: 0, status: 'idle', backend: '', total: 0, done: 0, current: '', error: '', unit: '', lines: [], pct: 0, elapsed: 0, eta: 0, active: false },
        runs: [run.run] });
      if (r === 'benchmark/runs/1') return json({ ...run, badges: { 'Synthetic-Chat': badges } });
      if (r.startsWith('badges') && m === 'DELETE') { badgeDeletes += 1; return json({ error: 'Synthetic badge store failure' }, 500); }
      if (r === 'prompts' && m === 'GET') return json({ prompts });
      const del = r.match(/^prompts\/(\d+)$/);
      if (del && m === 'DELETE') { promptDeletes += 1; prompts = prompts.filter((x) => x.id !== Number(del[1])); return json({ prompts }); }
      return json({});
    });

    await page.goto(`http://localhost:${PORT}`);
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'Models & routing' }).click();
    await settings.getByRole('button', { name: 'Open model manager' }).click();
    const dialog = page.locator('.model-manager-page');
    await dialog.waitFor();

    await check('#943 (5) a failed rating clear shows an alert and keeps the badge', async () => {
      await openModelsTab(dialog, 'Benchmarks');
      await dialog.getByRole('button', { name: 'View', exact: true }).click();
      const clear = dialog.getByRole('button', { name: /^Clear .*chat/i });
      await clear.waitFor();
      await clear.click();
      const alert = dialog.getByRole('alert').filter({ hasText: 'Synthetic badge store failure' });
      await alert.waitFor({ timeout: 3000 });
      assert.equal(badgeDeletes, 1, 'one DELETE reached the server');
      assert.ok(await dialog.getByRole('button', { name: /^Clear .*chat/i }).isVisible(), 'the badge is still shown');
    });

    await check('#943 (6) deleting a saved prompt needs confirmation', async () => {
      await openModelsTab(dialog, 'Prompts');
      const del = dialog.getByRole('button', { name: 'Delete Synthetic summary', exact: true });
      await del.waitFor({ timeout: 3000 });
      await del.click();
      await page.waitForTimeout(400);
      assert.equal(promptDeletes, 0, 'the first click must not send the DELETE');
      assert.ok(await dialog.locator('li', { hasText: 'Synthetic summary' }).isVisible(), 'prompt still listed');
      const group = dialog.getByRole('group', { name: 'Delete Synthetic summary' });
      await group.waitFor({ timeout: 3000 });
      // Keep cancels without deleting.
      await group.getByRole('button', { name: 'Keep', exact: true }).click();
      assert.equal(promptDeletes, 0);
      await dialog.getByRole('button', { name: 'Delete Synthetic summary', exact: true }).waitFor();
      // Confirming deletes only that prompt.
      await dialog.getByRole('button', { name: 'Delete Synthetic summary', exact: true }).click();
      await dialog.getByRole('group', { name: 'Delete Synthetic summary' }).getByRole('button', { name: 'Delete', exact: true }).click();
      await dialog.getByRole('button', { name: 'Delete Synthetic riddle', exact: true }).waitFor();
      await dialog.locator('li', { hasText: 'Synthetic summary' }).waitFor({ state: 'detached', timeout: 3000 });
      assert.equal(promptDeletes, 1);
    });

    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`benchmarks-943: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
