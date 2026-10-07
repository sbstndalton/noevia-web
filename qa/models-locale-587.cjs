// #587: German Models page. The unloaded state must not read like the Unload button, sizes and chart
// axes use the locale's decimal comma, and the capability tags are translated. Offline: synthetic
// model-manager APIs, no inference/storage/network. German is set by answering the preferences GET
// (page memory only; the real account is never touched).
//   npm run build && node qa/models-locale-587.cjs          (QA_DIST=<dir> serves another build)
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

(async () => {
  const fixture = createFixture(31587);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS models-locale-587: ${msg}`); };
  try {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const installed = [
      { name: 'Synthetic-Live', labels: [], loaded: true, sizeGB: 4.5, maxContext: 131072, source: 'cache', canDelete: true, status: 'loaded' },
      { name: 'Synthetic-Chat', labels: [], loaded: false, sizeGB: 3.3, maxContext: 131072, source: 'cache', canDelete: true, status: 'unloaded' },
      { name: 'Synthetic-Embed', labels: ['embeddings'], loaded: false, sizeGB: 0.6, maxContext: 8192, source: 'cache', canDelete: true, status: 'unloaded' },
      { name: 'Synthetic-Rerank', labels: ['reranking'], loaded: false, sizeGB: 0.7, maxContext: 8192, source: 'cache', canDelete: true, status: 'unloaded' },
    ];
    const now = Math.floor(Date.now() / 1000);
    const history = [0, 1, 2, 3].map((i) => ({ ts: now - (3 - i) * 2, gpu_util: 40 + i, vram_used_gb: 4.5 + i * 0.1, cpu_pct: 10 + i, mem_used_gb: 8 + i, shared_used_gb: 0, temp_c: 50, power_w: 100 }));
    const user = { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true };
    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user, passkeys: [] });
      if (p === '/api/account/preferences') return json({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'de-DE' });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles: {}, missing: [] });
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: installed.map((mo) => ({ key: `f/${mo.name}.gguf`, name: `${mo.name}.gguf`, subdir: 'f', bytes: mo.sizeGB * 1e9, size: `${(mo.sizeGB * 0.93).toFixed(1)} GB`, modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [mo.name], modelId: mo.name, file: `f/${mo.name}.gguf`, shape: mo.name === 'Synthetic-Live' ? { arch: 'llama', moe: false, experts: 0, active: 0, label: 'dense' } : null, loadedOn: [], fit: [], badges: [] })), unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/models', exists: true, disk: { total: 7.3 * 1024 ** 4, free: 5.3 * 1024 ** 4, usedPct: 27, totalH: '7.3 TB', freeH: '5.3 TB' } }, models: installed.length, sections: installed.length, backends: [], activeDownloads: 0, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      if (r === 'backends') return json({ backends: [{ name: 'llamacpp', found: true, status: 'running', image: 'synthetic', uptime: '1h', started_at: '', loaded_model: 'Synthetic-Live', probe_error: null, last_restart_error: null,
        stats: { ok: true, error: null, gpu: { vendor: 'x', name: 'Synthetic GPU', util_pct: 40, vram_used_gb: 4.9, vram_total_gb: 16.5, temp_c: 50, power_w: 100, gpu_count: 1, cards: [], memory_kind: 'dedicated', shared_used_gb: 0, shared_total_gb: 0, clock_mhz: 1500, source: 's', measured: true }, container: null }, history }] });
      if (r === 'host') return json({ history: history.map((h) => ({ ts: h.ts, cpu_pct: h.cpu_pct, mem_used_gb: h.mem_used_gb, mem_total_gb: 32, mem_available_gb: 20 })) });
      if (r === 'prompts') return json({ prompts: [] });
      if (/\/diagnose$/.test(r)) return json({ failures: [] });
      return json({});
    });

    await page.goto('http://localhost:31587');
    await page.getByRole('button', { name: /Kontomenü für/ }).filter({ visible: true }).first().click();
    await page.locator('.account-popover').getByRole('menuitem', { name: 'Einstellungen', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Einstellungen' });
    await settings.getByRole('button', { name: 'Modelle & Routing' }).click();
    await settings.getByRole('button', { name: 'Modellmanager öffnen' }).click();
    const dialog = page.locator('.model-manager-page');
    await dialog.waitFor();
    await dialog.getByRole('tab', { name: 'Deine Modelle', exact: true }).click();
    const chat = dialog.getByRole('article', { name: 'Synthetic-Chat' });
    await chat.waitFor();

    // (a) the state word is not the Unload verb
    const state = (await chat.locator('.model-card-state').innerText()).trim();
    assert.equal(state, 'Nicht geladen');
    const live = dialog.getByRole('article', { name: 'Synthetic-Live' });
    assert.equal((await live.locator('.model-card-state').innerText()).trim(), 'Geladen');
    assert.equal((await live.locator('.model-card-actions button', { hasText: /^Entladen$/ }).first().innerText()).trim(), 'Entladen');
    pass('unloaded card says "Nicht geladen", the loaded card keeps the "Entladen" button');

    // (b) sizes use the decimal comma
    assert.match(await chat.locator('.model-card-meta').first().innerText(), /3,3[\u00a0\u202f ]GB/);
    assert.match(await chat.locator('.model-card-meta').first().innerText(), /131\.072/);
    assert.equal(await chat.locator('.model-card-meta').first().innerText().then((s) => /\b3\.3 GB/.test(s)), false);
    const disk = (await dialog.getByTestId('models-disk').innerText()).replace(/\s+/g, ' ');
    assert.match(disk, /5,3[\u00a0\u202f ]TB frei von 7,3[\u00a0\u202f ]TB/);
    pass(`size "3,3 GB" and folder line "${disk}" use the decimal comma`);

    // (c) capability tags are translated
    const tags = async (name) => (await dialog.getByRole('article', { name }).locator('.model-card-tag').allInnerTexts()).map((s) => s.trim());
    const liveMeta = await live.locator('.model-card-meta').first().innerText();
    assert.match(liveMeta, /\bdicht\b/);
    assert.doesNotMatch(liveMeta, /\bdense\b/i);
    assert.ok((await tags('Synthetic-Embed')).includes('Einbettungen'), 'embeddings tag translated');
    assert.ok((await tags('Synthetic-Rerank')).includes('Re-Ranking'), 'reranking tag translated');
    for (const n of ['Synthetic-Embed', 'Synthetic-Rerank']) {
      for (const tag of await tags(n)) assert.ok(!/^(dense|embeddings|reranking)$/i.test(tag), `English tag "${tag}" on ${n}`);
    }
    pass('dense, embeddings and reranking tags are shown in German');

    // Hardware: axis ticks and tiles share the decimal comma
    await dialog.getByRole('tab', { name: 'Hardware', exact: true }).click();
    await dialog.locator('svg text.viz-axis').first().waitFor({ state: 'attached' });
    let axis = [];
    for (let i = 0; i < 40 && !axis.includes('16,5'); i += 1) {
      axis = (await dialog.locator('svg text.viz-axis').allTextContents()).map((s) => s.trim());
      if (!axis.includes('16,5')) await page.waitForTimeout(250);
    }
    assert.ok(axis.includes('8,3'), `axis ticks ${JSON.stringify(axis)} lack 8,3`);
    assert.ok(axis.includes('16,5'), `axis ticks ${JSON.stringify(axis)} lack 16,5`);
    assert.ok(!axis.some((s) => /\d\.\d/.test(s)), `English decimal in axis ticks ${JSON.stringify(axis)}`);
    pass('chart axis ticks use the decimal comma');

    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
    console.log(`models-locale-587: ${passed} checks passed`);
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
