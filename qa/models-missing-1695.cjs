// #1695: models whose file was deleted are not listed or counted, their presets are cleaned up, the
// reranker row says its file is gone (not "Off"), and Performance never offers Optimize for them.
// Synthetic APIs only; the owner's live model set from the 20b07d3f report. Fails on the pre-fix build:
//  - the grid shows "File missing" cards for the two deleted models and counts them ("8 of 8 models");
//  - nothing asks the server to remove the leftover presets;
//  - Performance -> Quality lists the deleted chat model with Optimize;
//  - the reranker row has no "file is gone" hint.
// QA_SCREENSHOTS (default /tmp/models-1695) receives 2000px and 390px shots, light and dark, of the
// state where the server had to keep one leftover preset (the only state where anything shows).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openModelsTab } = require('./nav.cjs');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const shots = process.env.QA_SCREENSHOTS || '/tmp/models-1695';
const tag = process.env.QA_TAG || 'run';
require('node:fs').mkdirSync(shots, { recursive: true });

const base = (o) => ({ labels: [], loaded: false, maxContext: 32768, source: 'preset', canDelete: true, status: 'unloaded', suggested: false, ...o });
const GONE_CHAT = 'gemma-4-E2B_q4_0-it', GONE_RERANK = 'qwen3-reranker-0.6b-q8_0';
const initialModels = () => [
  base({ name: 'gemma-4-12b-it-qat-q4_0', sizeGB: 7, labels: ['vision'] }),
  base({ name: GONE_CHAT, sizeGB: null, missingFile: true, failed: true, status: 'missing' }),
  base({ name: 'gemma-4-E4B', sizeGB: 4 }),
  base({ name: 'laya_multilingual_f16', sizeGB: 0.6, system: true, servedElsewhere: true }),
  base({ name: 'nomic-embed-text-v1', sizeGB: 0.3, loaded: true, status: 'loaded', sidecarProtected: true, labels: ['embeddings'] }),
  base({ name: GONE_RERANK, sizeGB: null, missingFile: true, failed: true, status: 'missing', labels: ['reranking'] }),
  base({ name: 'Qwen3.5-4B', sizeGB: 3 }),
  base({ name: 'Qwen3.5-9B', sizeGB: 6, loaded: true, status: 'loaded' }),
];

(async () => {
  const fixture = createFixture(31695);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const failures = [], errors = [];
  const check = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); } };
  // keep: names the (synthetic) server keeps on prune, as when the model service still sees a file.
  const session = async ({ width, theme, keep }) => {
    const page = await browser.newPage({ viewport: { width, height: 1250 }, isMobile: width < 768, hasTouch: width < 768 });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((t) => localStorage.setItem('cowork-theme', t), theme);
    let installed = initialModels();
    const calls = [];
    const files = () => installed.filter((m) => !m.missingFile && !m.servedElsewhere).map((m) => ({ key: `f/${m.name}.gguf`, name: `${m.name}.gguf`, subdir: 'f', bytes: (m.sizeGB || 1) * 1e9, size: `${m.sizeGB} GB`, modified: '2026-09-01', sharded: false, parts: 1, projector: null, sections: [m.name], modelId: m.name, file: `f/${m.name}.gguf`, shape: null, loadedOn: [], fit: [], badges: [] }));
    await page.route('**/api/**', async (route) => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
      const json = (b, status = 200) => route.fulfill({ status, json: b });
      if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
      if (p === '/api/models/installed') return json(installed);
      if (p === '/api/auto-roles' && m === 'GET') return json({ configured: true, roles: { fast: 'Qwen3.5-4B', smart: 'Qwen3.5-9B' }, missing: [] });
      if (p === '/api/models/prune-missing' && m === 'POST') {
        const gone = installed.filter((x) => x.missingFile).map((x) => x.name);
        const removed = gone.filter((n) => !keep.includes(n)), kept = gone.filter((n) => keep.includes(n));
        calls.push(['prune', removed]);
        installed = installed.filter((x) => !removed.includes(x.name));
        return json({ removed, kept, reloaded: removed.length > 0 });
      }
      // The core answer after #1695: a configured reranker whose file is gone is "missing", even with reranking off.
      if (p === '/api/models/assignments') return json({ admin: true, available: true, roles: {}, services: [
        { id: 'embedding', model: 'nomic-embed-text-v1', state: 'active', options: [], canChange: true, baseUrl: null },
        { id: 'reranker', model: GONE_RERANK, state: 'missing', options: [], canChange: false },
        { id: 'decision', model: 'laya_multilingual_f16', state: 'active', canChange: false },
        { id: 'ocr', model: null, state: 'off', canChange: false }, { id: 'documents', model: null, state: 'off', canChange: false },
      ] });
      if (!p.startsWith('/api/model-manager/')) return p.startsWith('/api/models/') ? json([]) : route.continue();
      const r = p.slice('/api/model-manager/'.length);
      if (r === 'models') return json({ models: files(), unregistered: [], revision: 'r1' });
      if (r === 'overview') return json({ modelsDir: { disk: { total: 1e12, free: 5e11, usedPct: 50, totalH: '1 TB', freeH: '500 GB' } }, revision: 'r1' });
      if (r === 'models/updates') return json({ status: {} });
      if (r === 'sections') return json({ revision: 'r1', sections: [] });
      return json({});
    });
    await page.goto('http://localhost:31695/models');
    const root = page.locator('.model-manager-page');
    await root.waitFor();
    await openModelsTab(root, 'Your models');
    await root.getByRole('article', { name: 'Qwen3.5-9B' }).waitFor();
    await page.waitForTimeout(500);
    return { page, root, calls };
  };
  try {
    // 1. The server removes both leftover presets: they vanish and are not counted.
    {
      const { page, root, calls } = await session({ width: 2000, theme: 'light', keep: [] });
      await check('the deleted models have no card', async () => {
        assert.equal(await root.getByRole('article', { name: GONE_CHAT }).count(), 0);
        assert.equal(await root.getByRole('article', { name: GONE_RERANK }).count(), 0);
        assert.equal(await root.locator('.model-card-state', { hasText: 'File missing' }).count(), 0);
      });
      await check('the count leaves them out (6 of 6, not 8 of 8)', async () => {
        assert.match(await root.locator('.mm-library-bar .mm-note').first().innerText(), /^6 of 6 models/);
      });
      await check('the page asked the server to remove the leftover presets', async () => {
        assert.deepEqual(calls.filter(([k]) => k === 'prune').map(([, v]) => v)[0], [GONE_CHAT, GONE_RERANK]);
      });
      await check('the reranker row says its file is gone, with what to do', async () => {
        const row = root.locator('[data-service="reranker"]');
        assert.equal((await row.locator('.mm-state').innerText()).trim(), 'File missing');
        assert.match(await row.innerText(), /Its file is gone\. Download a reranker/);
      });
      await check('Performance does not list or offer Optimize for the deleted model', async () => {
        await openModelsTab(root, 'Overview');
        const quality = root.getByRole('region', { name: 'Quality' }).or(root.locator('section[aria-labelledby="mm-quality"]')).first();
        await quality.waitFor({ timeout: 3000 });
        await quality.getByText('Qwen3.5-9B', { exact: true }).waitFor({ timeout: 3000 });
        assert.equal(await quality.getByText(GONE_CHAT, { exact: true }).count(), 0);
        assert.equal(await quality.locator('li', { hasText: GONE_CHAT }).getByRole('button', { name: 'Optimize' }).count(), 0);
      });
      await page.close();
    }
    // 2. The server keeps one (its file is still seen): still no card and not counted; one line names it.
    for (const [width, theme] of [[2000, 'light'], [2000, 'dark'], [390, 'light'], [390, 'dark']]) {
      const { page, root } = await session({ width, theme, keep: [GONE_CHAT] });
      await check(`${width} ${theme}: a kept leftover is one line with a retry, not a card`, async () => {
        assert.equal(await root.getByRole('article', { name: GONE_CHAT }).count(), 0);
        const line = root.getByTestId('models-leftover');
        assert.match(await line.innerText(), new RegExp(`The file of ${GONE_CHAT.replace(/[.]/g, '\\.')} is gone`));
        await line.getByRole('button', { name: 'Remove leftover settings' }).waitFor({ timeout: 1000 });
        assert.match(await root.locator('.mm-library-bar .mm-note').first().innerText(), /^6 of 6 models/);
      });
      await check(`${width} ${theme}: no horizontal overflow`, async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
      await page.screenshot({ path: `${shots}/models-missing-${tag}-${width}-${theme}.png`, fullPage: width >= 768 });
      await page.close();
    }
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally { await browser.close(); await fixture.close(); }
  if (failures.length) { console.log(`FAIL ${failures.length} check(s)`); process.exitCode = 1; } else console.log('PASS #1695 deleted models are not listed or counted, presets are pruned, the reranker says its file is gone, no Optimize; 2000/390 light/dark.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
