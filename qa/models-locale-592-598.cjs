// #592/#596/#597/#598: what the model manager service and server send as English or as
// English-formatted text must read German in the German UI: Discover's free space, percentages
// (Hardware tile and chart axis), engine uptime, benchmark run status, the Details evidence
// limitation, the last-tune drafting label ("Off") and the Advanced group titles. Offline:
// synthetic model-manager APIs only; German is set by answering the preferences GET (page memory,
// the real account is never touched). Fails on a build without the fix, passes with it.
//   npm run build && node qa/models-locale-592-598.cjs      (QA_DIST=<dir> serves another build)
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = Number(process.env.QA_PORT || 31598);
(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const results = [];
  // Every check runs and is reported; the script exits non-zero if any failed.
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS models-locale-592-598: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL models-locale-592-598: ${name}\n  ${String(e.message).split('\n').slice(0, 3).join('\n  ')}`); }
  };
  try {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => { errors.push(e.message); if (process.env.QA_DEBUG) console.log(e.stack); });

    const installed = [
      { name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, maxContext: 131072, source: 'cache', canDelete: true, status: 'loaded' },
    ];
    const now = Math.floor(Date.now() / 1000);
    const history = [0, 1, 2, 3].map((i) => ({ ts: now - (3 - i) * 2, gpu_util: 40 + i, vram_used_gb: 4.5 + i * 0.1, cpu_pct: 10 + i, mem_used_gb: 8 + i, shared_used_gb: 0, temp_c: 50, power_w: 100 }));
    const user = { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true };
    const LIMIT = 'Three deterministic quality smoke probes, not a general quality benchmark';
    const evidence = { tracked: true, categories: [
      { category: 'context_capacity', state: 'verified', value: { ctx: 32768 }, result: 'passed', at: Date.now(), suite: { name: 'full-autotune', version: 3 }, limitations: [LIMIT, '120 s default prompt budget; existing MTP head only'],
        limitationKeys: [{ id: 'autotune-quality', params: {} }, { id: 'autotune-budget', params: {} }] },
    ], external: { category: 'external_model_card', state: 'unavailable', value: null, at: null, suite: null, provenance: null, limitations: [] } };
    const schema = ['Common', 'Speculative decoding'].map((tier, i) => ({ tier, tierId: ['common', 'speculative'][i], open: i === 0, fields: [{ key: i ? 'spec-type' : 'ctx-size', label: 'Field', kind: 'text', choices: [], placeholder: '', help: '' }] }));
    const openApis = async () => page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user, passkeys: [] });
      if (p === '/api/account/preferences') return json({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'de-DE' });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/models/evidence') return json(evidence);
      if (p === '/api/models/autotune') return json({ job: null, history: [{ at: Date.now(), spec: 'off', specLabel: 'Off', generation: 44.8, kv: 'q8_0', context: 32768 }] });
      if (p === '/api/models/estimate') return json({ error: 'No estimate for the synthetic model' }, 404);
      if (p === '/api/models/calibration') return json({ job: null, history: [] });
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles: {}, missing: [] });
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json({}) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: installed.map((mo) => ({ key: `f/${mo.name}.gguf`, name: `${mo.name}.gguf`, subdir: 'f', bytes: mo.sizeGB * 1e9, size: '3.1 GB', modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [mo.name], modelId: mo.name, file: `f/${mo.name}.gguf`, shape: null, loadedOn: [], fit: [], badges: [] })), unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { path: '/models', hostPath: '/mnt/models', exists: true, disk: { total: 7.3 * 1024 ** 4, free: 5.3 * 1024 ** 4, usedPct: 27, totalH: '7.3 TB', freeH: '5.3 TB' } }, models: 1, sections: 1, backends: [], activeDownloads: 0, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      if (r === 'download-targets') return json({ targets: [] });
      if (r === 'downloads') return json({ jobs: [] });
      if (r === 'settings') return json({ hasToken: false, tokenHint: '' });
      if (r === 'backends') return json({ backends: [{ name: 'llamacpp', found: true, status: 'running', image: 'synthetic', uptime: '1h 14m', uptime_s: 4440, started_at: '', loaded_model: 'Synthetic-Chat', probe_error: null, last_restart_error: null,
        stats: { ok: true, error: null, gpu: { vendor: 'x', name: 'Synthetic GPU', util_pct: 27, vram_used_gb: 4.9, vram_total_gb: 16.5, temp_c: 50, power_w: 100, gpu_count: 1, cards: [], memory_kind: 'dedicated', shared_used_gb: 0, shared_total_gb: 0, clock_mhz: 1500, source: 's', measured: true }, container: null }, history }] });
      if (r === 'host') return json({ history: history.map((h) => ({ ts: h.ts, cpu_pct: h.cpu_pct, mem_used_gb: h.mem_used_gb, mem_total_gb: 32, mem_available_gb: 20 })) });
      if (r === 'benchmark') return json({ sections: ['Synthetic-Chat'], sweepArgs: {}, prompts: [], backends: ['llamacpp'], maxTokensDefault: 256, maxTokensCeiling: 1024, categories: [],
        job: { run_id: 0, status: 'idle', backend: '', total: 0, done: 0, current: '', error: '', unit: '', lines: [], pct: 0, elapsed: 0, eta: 0, active: false },
        runs: [{ id: 1, backend: 'cowork-llama-1', status: 'done', started_at: now - 3600, finished_at: now - 3500, reps: 1, max_tokens: 64, note: '' }] });
      if (r === 'prompts') return json({ prompts: [] });
      if (r === 'sections') return json({ sections: [{ name: 'Synthetic-Chat', values: {}, revision: 'r1' }], raw: '', schema, revision: 'r1' });
      if (/^sections\/[^/]+$/.test(r) && m === 'GET') return json({ name: 'Synthetic-Chat', exists: true, values: {}, extras: '', revision: 'r1', hints: [], schema, defaults: {}, backups: [] });
      return json({});
    });
    await openApis();

    await page.goto(`http://localhost:${PORT}`);
    await page.getByRole('button', { name: /Kontomenü für/ }).filter({ visible: true }).first().click();
    await page.locator('.account-popover').getByRole('menuitem', { name: 'Einstellungen', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Einstellungen' });
    await settings.getByRole('button', { name: 'Modelle & Routing' }).click();
    await settings.getByRole('button', { name: 'Modellmanager öffnen' }).click();
    const dialog = page.locator('.model-manager-page');
    await dialog.waitFor();
    const NB = '[\\u00a0\\u202f ]';

    await check('#596 Discover free space uses the decimal comma', async () => {
      await dialog.getByRole('tab', { name: 'Entdecken', exact: true }).click();
      const note = dialog.getByTestId('download-target');
      await note.waitFor();
      const text = (await note.innerText()).replace(/\s+/g, ' ');
      assert.match(text, /5,3[\u00a0\u202f ]TB frei/, `free space line: ${text}`);
      assert.doesNotMatch(text, /5\.3 TB/);
    });

    await check('#597 Hardware percentages use the locale percent format, and uptime uses German units', async () => {
      await dialog.getByRole('tab', { name: 'Hardware', exact: true }).click();
      const tile = dialog.locator('.mm-tile, [class*="tile"]').filter({ hasText: 'Auslastung' }).first();
      await tile.waitFor();
      const tileText = (await tile.innerText()).replace(/\s+/g, ' ');
      assert.match(tileText, new RegExp(`27${NB}%`), `GPU tile: ${tileText}`);
      let axis = [];
      for (let i = 0; i < 40 && !axis.some((s) => /50/.test(s)); i += 1) {
        axis = (await dialog.locator('svg text.viz-axis').allTextContents()).map((s) => s.trim());
        if (!axis.some((s) => /50/.test(s))) await page.waitForTimeout(250);
      }
      assert.ok(axis.some((s) => new RegExp(`^50${NB}%$`).test(s)), `axis ticks ${JSON.stringify(axis)} lack a locale percent "50 %"`);
      assert.ok(!axis.some((s) => /^\d+%$/.test(s)), `plain "%" tick in ${JSON.stringify(axis)}`);
      const note = (await dialog.locator('.mm-note', { hasText: 'synthetic' }).first().innerText()).replace(/\s+/g, ' ');
      assert.match(note, /läuft seit 1 Std\.?,? 14 Min/, `uptime: ${note}`);
      assert.doesNotMatch(note, /1h 14m/);
    });

    await check('#597 benchmark run status is translated', async () => {
      await dialog.getByRole('tab', { name: 'Benchmarks', exact: true }).click();
      const row = dialog.locator('#mm-runs').locator('..').locator('li').first();
      await row.waitFor();
      const text = (await row.innerText()).replace(/\s+/g, ' ');
      assert.match(text, /cowork-llama-1 · Fertig/, `run row: ${text}`);
      assert.doesNotMatch(text, /\bdone\b/);
    });

    await dialog.getByRole('tab', { name: 'Deine Modelle', exact: true }).click();
    const card = dialog.getByRole('article', { name: 'Synthetic-Chat' });
    await card.waitFor();
    await card.getByRole('button', { name: 'Synthetic-Chat tunen', exact: true }).click();

    await check('#598 Details: evidence limitation is German', async () => {
      const evidenceBlock = dialog.locator('.mm-evidence').first();
      await evidenceBlock.waitFor();
      const text = (await evidenceBlock.innerText()).replace(/\s+/g, ' ');
      assert.match(text, /Drei deterministische Qualitäts-Stichproben/, `evidence: ${text}`);
      assert.doesNotMatch(text, /deterministic quality smoke probes/);
    });

    await check('#598 Details: the last-tune drafting label is German ("Aus", not "Off")', async () => {
      const line = dialog.locator('.mm-note', { hasText: 'Zuletzt getunt' }).first();
      await line.waitFor();
      const last = (await line.innerText()).replace(/\s+/g, ' ');
      assert.match(last, /: Aus, 44,8/, `last tune line: ${last}`);
      assert.doesNotMatch(last, /\bOff\b/);
    });

    await check('#598 Advanced group titles are German', async () => {
      const advanced = dialog.getByRole('button', { name: 'Erweitert', exact: true });
      await advanced.waitFor();
      await advanced.click();
      const titles = (await dialog.locator('.mm-tier > summary').allInnerTexts()).map((s) => s.trim());
      assert.ok(titles.some((s) => /^Spekulatives Dekodieren/.test(s)), `group titles ${JSON.stringify(titles)}`);
      assert.ok(!titles.some((s) => /^Speculative decoding/.test(s)), `English group title in ${JSON.stringify(titles)}`);
    });

    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`models-locale-592-598: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
