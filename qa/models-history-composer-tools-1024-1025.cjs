// #1024 #1025 (live click-test of e2209540). Offline: synthetic API stubs only, no inference.
//  #1024 Models & routing: each section the person clicks is a history entry, so Back returns to
//        the previous section (and then to the page before /models); forward re-opens it; the
//        first normalisation of a legacy address (?section=benchmarks) does not add an entry;
//  #1025 Tools is in the composer's + menu at every width: in Manual its list sits in the menu
//        and there is no second Tools button beside the composer (a row in the menu still opens
//        the searchable catalogue); a model's Tune page has one Auto-tune entry, the open
//        "Auto-tune and apply" panel, not a second "Go to Auto-tune and apply" button.
// Fails on a build without the change (web main 66e0e11e). QA_SHOTS=<dir> writes screenshots
// (set QA_SHOT_TAG=before|after to name them).
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> [QA_SHOTS=dir] node qa/models-history-composer-tools-1024-1025.cjs
const os = require('node:os');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { openModelsTab } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31924);
const SHOTS = process.env.QA_SHOTS || '';
const TAG = process.env.QA_SHOT_TAG || 'run';
const NAME = 'Synthetic-9B-Q5';
const schema = [{ tier: 'Common', open: true, fields: [{ key: 'model', label: 'Model file', kind: 'text', choices: [], placeholder: '', help: '' }, { key: 'ctx-size', label: 'Context size', kind: 'int', choices: [], placeholder: '8192', help: '' }] }];

async function stub(page) {
  const project = { id: 'p-syn', name: 'Synthetic chat', routing: 'auto', files: [], assets: [], toolboxes: ['core', 'search'], toolsMode: 'manual' };
  const box = (id, label) => ({ id, label, description: `${label}, synthetic.`, toolCount: 1, estTokens: 40, source: 'builtin', available: true });
  await page.route('**/api/**', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
    const json = (b, status = 200) => route.fulfill({ status, json: b });
    if (p === '/api/features') return json({ flags: { previews: false } });
    if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
    if (/^\/api\/chats\/[^/]+\/context$/.test(p)) return json({ project: { ...project } });
    if (p === '/api/providers') return json({ providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }] });
    if (p === '/api/routing-mode' && m === 'GET') return json({ enabled: true, storedMode: 'local', mode: 'local', whenSensitive: 'ask', cloud: { providerId: '', fast: '', smart: '', code: '' }, allowed: ['local'], admin: true });
    if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: NAME, smart: NAME }, missing: [] });
    if (p === '/api/routing-default') return json({ routing: 'auto' });
    if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, autotune: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
    if (p === '/api/models/installed') return json([{ name: NAME, loaded: true, labels: [], sizeGB: 6.6, status: 'loaded' }]);
    if (p === '/api/models/inference-budget') return json({}, 404);
    if (p === '/api/models/evidence') return json({ tracked: true, categories: [] });
    if (p === '/api/models/estimate') return json({ model: NAME, budgetGib: null, chat: true, sizeable: true, arch: 'qwen35', nativeCtx: 262144, modelGib: 6.15, pinnedGib: 0, reserveGib: 1, safety: 1.05, moe: false, rows: [], current: { ctx: 16384, kv: 'q8_0' } });
    if (p === '/api/models/hardware') return json({ source: 'model-manager', cpu: 'Synthetic CPU', systemGB: 64, gpus: [] });
    if (p === '/api/models/autotune') return json({ job: null, history: [] });
    if (p === '/api/models/autotune/untuned') return json({ models: [], skipped: [] });
    if (p === '/api/models/calibration') return json({ job: null, history: [] });
    if (p === '/api/toolboxes') return json({ toolboxes: [box('core', 'Core'), box('search', 'Web search')], mcp: { configured: false, servers: [] } });
    if (p === '/api/toolboxes/permitted') {
      const pb = (id, label, active) => ({ id, label, description: `${label}, synthetic.`, source: 'builtin', state: 'available', reason: null, active, tools: [{ name: `${id}_tool`, description: 'Synthetic tool.', write: false, permission: 'allowed', reason: null }] });
      return json({ boxes: [pb('core', 'Core', true), pb('search', 'Web search', false)] });
    }
    if (/^\/api\/projects\/[^/]+\/config$/.test(p)) return json({ ok: true });
    if (p === '/api/model-manager/sections') return json({ revision: 'r1', schema, sections: [{ name: NAME, items: [['ctx-size', '16384']], hasFile: true, file: 'q/x.gguf', cli: 'llama-server' }], unregistered: [], backups: [] });
    if (p.startsWith('/api/model-manager/sections/')) return json({ name: NAME, exists: true, values: { model: '/models/q/x.gguf', 'ctx-size': '16384' }, extras: '', hints: [], revision: 'r1', schema });
    if (p === '/api/model-manager/downloads') return json({ jobs: [] });
    if (p === '/api/model-manager/benchmark') return json({ sections: [NAME], sweepArgs: {}, prompts: [], backends: ['llamacpp'], maxTokensDefault: 256, maxTokensCeiling: 1024, categories: [{ key: 'chat', label: 'Chat' }], job: { run_id: 0, status: 'idle', backend: '', total: 0, done: 0, current: '', error: '', unit: '', lines: [], pct: 0, elapsed: 0, eta: 0, active: false }, runs: [] });
    if (p === '/api/model-manager/prompts') return json({ prompts: [] });
    if (p.startsWith('/api/model-manager/') || p.startsWith('/api/models/') || p === '/api/sampling-settings' || p === '/api/reasoning-settings') return json({});
    return route.continue();
  });
}

async function newPage(browser, { width, height }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript(() => { try { localStorage.setItem('noevia:theme-family', 'editorial'); localStorage.setItem('cowork-theme', 'dark'); } catch { /* ignore */ } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stub(page);
  return page;
}
const selected = (page) => page.locator('.model-manager-page [role="tab"][aria-selected="true"]').first().innerText().then((s) => s.trim());
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/${name}-${TAG}.png` }); };

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS 1024-1025: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL 1024-1025: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); }
  };
  try {
    await check('#1024 Back after Routing then Performance returns to Routing, then Models, and Forward re-opens', async () => {
      const page = await newPage(browser, { width: 1440, height: 950 });
      await page.goto(`http://localhost:${PORT}/settings/profile`).catch(() => undefined);
      await page.goto(`http://localhost:${PORT}/models`);
      const root = page.locator('.model-manager-page');
      await root.waitFor();
      await page.waitForTimeout(200);
      const base = await page.evaluate(() => history.length);
      for (const [name, search] of [['Routing', '?section=routing'], ['Performance', '?section=performance']]) {
        await root.getByRole('tab', { name, exact: true }).click();
        await page.waitForFunction((want) => location.search === want, search);
        await page.waitForTimeout(50);
      }
      await shot(page, '1024-performance');
      assert.equal(await page.evaluate(() => history.length), base + 2, 'each section click adds one history entry');
      await page.goBack();
      await page.waitForFunction(() => location.search === '?section=routing');
      assert.equal(await selected(page), 'Routing', 'Back shows the previous section');
      await shot(page, '1024-back-routing');
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/models' && location.search === '');
      assert.equal(await selected(page), 'Models', 'a second Back shows Models, still on the page');
      await page.goForward();
      await page.waitForFunction(() => location.search === '?section=routing');
      assert.equal(await selected(page), 'Routing', 'Forward re-opens Routing');
      await page.close();
    });

    await check('#1024 a legacy address is normalised in place (no extra history entry), and re-clicking the open section adds none', async () => {
      const page = await newPage(browser, { width: 1440, height: 950 });
      await page.goto(`http://localhost:${PORT}/models?section=benchmarks`);
      const root = page.locator('.model-manager-page');
      await root.waitFor();
      await page.waitForFunction(() => location.search === '?section=performance');
      const len = await page.evaluate(() => history.length);
      await root.getByRole('tab', { name: 'Performance', exact: true }).click();
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => history.length), len, 'same section: no new entry');
      await page.goto(`http://localhost:${PORT}/models`);
      await root.waitFor();
      await page.waitForTimeout(150);
      const bare = await page.evaluate(() => history.length);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => history.length), bare, 'a bare /models adds nothing on its own');
      await page.close();
    });

    for (const [device, width, height] of [['desktop', 1440, 950], ['phone', 390, 844]]) {
      await check(`#1025 Manual (${device}): the + menu holds the switch and the list; no second Tools button beside the composer`, async () => {
        const page = await newPage(browser, { width, height });
        await page.goto(`http://localhost:${PORT}`);
        await page.getByRole('button', { name: /^Add files and tools/ }).click();
        const menu = page.getByRole('region', { name: /files and tools/i });
        await menu.getByRole('radiogroup', { name: 'How this chat picks its tools' }).waitFor();
        await menu.getByRole('menuitemcheckbox').first().waitFor();
        assert.equal(await menu.getByRole('menuitemcheckbox').count(), 2, 'the tool list is in the + menu');
        await shot(page, `1025-plus-menu-${device}`);
        const standalone = await page.locator('.tool-catalogue-trigger').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').length);
        assert.equal(standalone, 0, 'no visible standalone Tools button');
        const row = menu.locator('.composer-browse-tools');
        assert.equal(await row.isVisible(), true, 'the menu row that opens the catalogue stays reachable');
        await row.click();
        await page.getByRole('combobox').waitFor();
        await page.getByRole('option', { name: /Web search/ }).click();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Add files and tools · 1 for this message', exact: true }).waitFor();
        assert.equal(await page.locator('.composer-add-badge').isVisible(), true, 'the + carries the per-message count');
        await shot(page, `1025-composer-${device}`);
        await page.close();
      });
    }

    await check('#1025 a model\'s Tune page has one Auto-tune entry: the open "Auto-tune and apply" panel, no second button', async () => {
      const page = await newPage(browser, { width: 1440, height: 950 });
      await page.goto(`http://localhost:${PORT}/models`);
      const root = page.locator('.model-manager-page');
      await root.waitFor();
      await openModelsTab(root, 'Your models');
      await root.getByRole('article', { name: NAME }).getByRole('button', { name: 'Tune' }).click();
      const guided = root.locator('details.mm-guided');
      await guided.waitFor();
      if (!(await guided.evaluate((d) => d.open))) await guided.locator('summary').first().click();
      const panel = root.locator('.mm-easy-autotune');
      await panel.waitFor();
      assert.equal(await panel.evaluate((d) => d.open), true, 'the Auto-tune and apply panel is open');
      await shot(page, '1025-tune');
      assert.equal(await root.getByRole('button', { name: 'Go to Auto-tune and apply' }).count(), 0, 'no second "Go to Auto-tune and apply" entry');
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`1024-1025: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
