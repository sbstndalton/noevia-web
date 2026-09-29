// #600/#603: what the model manager and the chat footer used to send or print in English must read
// German in the German UI: an Advanced llama.cpp field's label and help (translated from the stable
// field id), a compact count (Mio., not "M"), the chat reply meta words ("Tokens", "Tok/s"), and a
// stopped engine's uptime (no duration from its last start; it reads "Gestoppt"). Offline: synthetic
// model-manager and chat APIs only; German is set by answering the preferences GET (page memory,
// the real account is never touched). Fails on a build without the fix, passes with it.
//   npm run build && node qa/locale-600-603.cjs      (QA_DIST=<dir> serves another build)
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = Number(process.env.QA_PORT || 31600);
(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const results = [];
  // Every check runs and is reported; the script exits non-zero if any failed.
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS locale-600-603: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL locale-600-603: ${name}\n  ${String(e.message).split('\n').slice(0, 3).join('\n  ')}`); }
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
    const EN_HELP = 'Prompt context length in tokens. 0 = load from model metadata. Larger uses more VRAM for KV cache.';
    // The service's own English text is what an old client would show; `id` is the stable handle.
    const schema = [{ tier: 'Common', tierId: 'common', open: true, fields: [
      { id: 'ctx-size', key: 'ctx-size', label: 'Context size', kind: 'text', choices: [], placeholder: '', help: EN_HELP },
      { id: 'flash-attn', key: 'flash-attn', label: 'Flash attention', kind: 'text', choices: [], placeholder: '', help: 'Fused attention kernel.' },
    ] }];
    // Two engines: one running, one exited. The stopped one carries what a service before #603 sent:
    // the span since it LAST started (13 d 16 h), which must never read as an uptime.
    const backend = (name, image, status, uptime, uptime_s) => ({ name, found: true, status, image, uptime, uptime_s, started_at: '', loaded_model: null, probe_error: null, last_restart_error: null,
      stats: { ok: true, error: null, gpu: { vendor: 'x', name: 'Synthetic GPU', util_pct: 27, vram_used_gb: 4.9, vram_total_gb: 16.5, temp_c: 50, power_w: 100, gpu_count: 1, cards: [], memory_kind: 'dedicated', shared_used_gb: 0, shared_total_gb: 0, clock_mhz: 1500, source: 's', measured: true }, container: null }, history });
    const backends = [backend('llamacpp', 'synthetic-running', 'running', '1h 14m', 4440), backend('llama-vulkan-test', 'synthetic-stopped', 'exited', '13d 16h', 1182937)];
    const stream = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    await page.route('**/api/**', (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user, passkeys: [] });
      if (p === '/api/account/preferences') return json({ notifications: { replyFinished: true, approvalNeeded: true }, sendKey: 'enter', locale: 'de-DE' });
      // 2.4 million tokens served in total: the engine total is a compact count.
      if (p === '/api/stats') return json({ up: true, tokensPerSecond: 11, timeToFirstToken: 0.2, inputTokens: 5, outputTokens: 5, telemetryScope: null, inputTokensTotal: 2400000, outputTokensTotal: 1500, requestCount: 3, cpuPercent: 10, gpuPercent: 20, vramGb: 4, memoryGb: 8, mtp: [] });
      if (p === '/api/chat' && m === 'POST') {
        return route.fulfill({ status: 200, contentType: 'text/event-stream', body: stream([
          { type: 'delta', text: 'Synthetic streamed reply' },
          { type: 'usage', promptTokens: 12, completionTokens: 34, totalTokens: 46, tokensPerSecond: 77 },
          { type: 'done' },
        ]) });
      }
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/models/evidence') return json({ tracked: true, categories: [], external: { category: 'external_model_card', state: 'unavailable', value: null, at: null, suite: null, provenance: null, limitations: [] } });
      if (p === '/api/models/autotune') return json({ job: null, history: [] });
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
      if (r === 'backends') return json({ backends });
      if (r === 'host') return json({ history: history.map((h) => ({ ts: h.ts, cpu_pct: h.cpu_pct, mem_used_gb: h.mem_used_gb, mem_total_gb: 32, mem_available_gb: 20 })) });
      if (r === 'benchmark') return json({ sections: ['Synthetic-Chat'], sweepArgs: {}, prompts: [], backends: ['llamacpp'], maxTokensDefault: 256, maxTokensCeiling: 1024, categories: [],
        job: { run_id: 0, status: 'idle', backend: '', total: 0, done: 0, current: '', error: '', unit: '', lines: [], pct: 0, elapsed: 0, eta: 0, active: false }, runs: [] });
      if (r === 'prompts') return json({ prompts: [] });
      if (r === 'sections') return json({ sections: [{ name: 'Synthetic-Chat', values: {}, revision: 'r1' }], raw: '', schema, revision: 'r1' });
      if (/^sections\/[^/]+$/.test(r) && m === 'GET') return json({ name: 'Synthetic-Chat', exists: true, values: {}, extras: '', revision: 'r1', hints: [], schema, defaults: {}, backups: [] });
      return json({});
    });

    await page.goto(`http://localhost:${PORT}`);

    await check('#600 chat reply meta words are German ("Tokens", "Tok/s") with locale numbers', async () => {
      await page.locator('textarea').first().fill('live tokens synthetic');
      await page.keyboard.press('Enter');
      // The first .msg-meta is the live timer ("0,0 s · generating…") until the reply finishes; wait
      // for the finished footer, or this reads the timer when the reply is still being drawn.
      const meta = page.locator('.msg-meta', { hasText: /Tokens/ }).first();
      await meta.waitFor();
      const text = (await meta.innerText()).replace(/\s+/g, ' ');
      assert.match(text, /46 Tokens \(12 rein \/ 34 raus\)/, `reply meta: ${text}`);
      assert.match(text, /77,0 Tok\/s/, `reply meta rate: ${text}`);
      assert.doesNotMatch(text, /\btokens\b|\bin \/|\bout\)|tok\/s/, `English meta words in: ${text}`);
    });

    await check('#600 the engine total is a German compact count ("2,4 Mio."), not "2.4M"', async () => {
      const total = page.locator('[data-stat="total"] dd');
      await total.waitFor();
      let text = '';
      for (let i = 0; i < 40 && !/Mio/.test(text); i += 1) { text = (await total.innerText()).replace(/\s+/g, ' '); if (!/Mio/.test(text)) await page.waitForTimeout(250); }
      assert.match(text, /2,4\s?Mio\./, `engine total: ${text}`);
      assert.doesNotMatch(text, /\d\.\dM\b|\d\.\d\s?m\b/i, `English compact suffix in: ${text}`);
    });

    await page.getByRole('button', { name: /Kontomenü für/ }).filter({ visible: true }).first().click();
    await page.locator('.account-popover').getByRole('menuitem', { name: 'Einstellungen', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Einstellungen' });
    await settings.getByRole('button', { name: 'Modelle & Routing' }).click();
    await settings.getByRole('button', { name: 'Modellmanager öffnen' }).click();
    const dialog = page.locator('.model-manager-page');
    await dialog.waitFor();

    await check('#603 a stopped engine reads "Gestoppt" where its uptime would be, and a running one keeps its uptime', async () => {
      await dialog.getByRole('tab', { name: 'Hardware', exact: true }).click();
      const stopped = dialog.locator('.mm-note', { hasText: 'synthetic-stopped' }).first();
      await stopped.waitFor();
      const stoppedText = (await stopped.innerText()).replace(/\s+/g, ' ');
      assert.match(stoppedText, /synthetic-stopped · Gestoppt ·/, `stopped engine note: ${stoppedText}`);
      assert.doesNotMatch(stoppedText, /läuft seit|13|1\.182\.937/, `a duration for a stopped engine: ${stoppedText}`);
      const running = (await dialog.locator('.mm-note', { hasText: 'synthetic-running' }).first().innerText()).replace(/\s+/g, ' ');
      assert.match(running, /läuft seit 1 Std\.?,? 14 Min/, `running engine note: ${running}`);
    });

    await dialog.getByRole('tab', { name: 'Deine Modelle', exact: true }).click();
    const card = dialog.getByRole('article', { name: 'Synthetic-Chat' });
    await card.waitFor();
    await card.getByRole('button', { name: 'Synthetic-Chat tunen', exact: true }).click();

    await check('#600 Advanced field label and help are German, from the stable field id', async () => {
      const advanced = dialog.getByRole('button', { name: 'Erweitert', exact: true });
      await advanced.waitFor();
      await advanced.click();
      const tier = dialog.locator('.mm-tier').first();
      await tier.waitFor();
      const labels = (await tier.locator('.mm-field label').allInnerTexts()).map((s) => s.trim());
      assert.ok(labels.includes('Kontextgröße'), `field labels ${JSON.stringify(labels)}`);
      assert.ok(labels.includes('Flash Attention'), `field labels ${JSON.stringify(labels)}`);
      assert.ok(!labels.includes('Context size'), `English field label in ${JSON.stringify(labels)}`);
      const help = (await tier.locator('.mm-field small').allInnerTexts()).join(' | ');
      assert.match(help, /Länge des Prompt-Kontexts in Tokens/, `field help: ${help}`);
      assert.doesNotMatch(help, /Prompt context length/, `English field help: ${help}`);
    });

    assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`locale-600-603: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
