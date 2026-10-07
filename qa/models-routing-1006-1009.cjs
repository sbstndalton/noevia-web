// #1006 #1007 #1008 #1009 (owner review, 2026-10-07). Offline: synthetic routes only, the
// provider's model list is a stub (no cloud call), nothing real.
//  #1008 Settings → Models & routing has four sections (Models, Routing, Performance, Advanced), an
//        old saved tab lands on its new home, and Sign in with ChatGPT is in Routing;
//  #1009 the cloud model fields are searchable pickers filled from the provider's listed models,
//        refreshable, with a custom entry;
//  #1006 the model dialog has no tool list; the composer's Tools switch hides the checkboxes in
//        Automatic and shows them in Manual, and the choice is saved on the chat;
//  #1007 Auto in the model dialog offers the same routing choices as Settings, saved per chat.
// Fails on a build without the change. QA_SHOTS=<dir> also writes the screenshots: 3 families x
// light/dark x desktop/phone of the Routing section and the model dialog.
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=../dist-after [QA_SHOTS=dir] node qa/models-routing-1006-1009.cjs
const os = require('node:os');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31906);
const SHOTS = process.env.QA_SHOTS || '';
const LISTED = ['syn-fast-1', 'syn-smart-2', 'syn-code-3', 'syn-vision-4'];

function scenario() {
  const state = {
    project: { id: 'p-syn', name: 'Synthetic chat', routing: 'auto', files: [], assets: [], toolboxes: ['core'], toolsMode: 'auto' },
    routing: { storedMode: 'cloud', mode: 'cloud', whenSensitive: 'ask', cloud: { providerId: 'prov-syn', fast: '', smart: 'syn-smart-2', code: '' } },
    configPatches: [], routingPuts: [], modelListCalls: [],
  };
  return state;
}

async function stub(page, state) {
  const box = (id, label) => ({ id, label, description: `${label}, synthetic.`, toolCount: 1, estTokens: 40, source: 'builtin', available: true });
  await page.route('**/api/**', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
    const json = (b, status = 200) => route.fulfill({ status, json: b });
    if (p === '/api/features') return json({ flags: { previews: false, chatgptOAuth: true, routingModes: true } });
    if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
    if (/^\/api\/chats\/[^/]+\/context$/.test(p)) return json({ project: { ...state.project } });
    if (p === '/api/providers') return json({ providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }, { id: 'prov-syn', label: 'Synthetic Cloud', baseUrl: 'https://cloud.synthetic.invalid/v1', apiKeyMasked: '…0000' }] });
    if (p === '/api/providers/prov-syn/models') { state.modelListCalls.push(url.search); return json({ models: LISTED, cached: url.search !== '?refresh=1' }); }
    if (p === '/api/providers/chatgpt') return json({ state: 'disconnected', providerId: 'chatgpt-oauth', external: true });
    if (p === '/api/routing-mode' && m === 'GET') return json({ enabled: true, ...state.routing, allowed: ['local', 'cloud', 'hybrid'], admin: true });
    if (p === '/api/routing-mode' && m === 'PUT') { const body = req.postDataJSON(); state.routingPuts.push(body); Object.assign(state.routing, { storedMode: body.mode, mode: body.mode, whenSensitive: body.whenSensitive, cloud: body.cloud }); return json({ enabled: true, ...state.routing, allowed: ['local', 'cloud', 'hybrid'], admin: true }); }
    if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: 'Synthetic-Chat', smart: 'Synthetic-Chat' }, missing: [] });
    if (p === '/api/routing-default') return json({ routing: 'auto' });
    if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
    if (p === '/api/models/installed') return json([{ name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, source: 'cache', status: 'loaded' }]);
    if (p === '/api/models/inference-budget') return json({}, 404);
    if (p === '/api/toolboxes') return json({ toolboxes: [box('core', 'Core'), box('search', 'Web search')], mcp: { configured: false, servers: [] } });
    if (/^\/api\/projects\/[^/]+\/config$/.test(p)) { const body = req.postDataJSON(); state.configPatches.push(body); Object.assign(state.project, body); if (body.routingMode === null) delete state.project.routingMode; return json({ ok: true }); }
    if (p === '/api/model-manager/benchmark') return json({ sections: ['Synthetic-Chat'], sweepArgs: {}, prompts: [], backends: ['llamacpp'], maxTokensDefault: 256, maxTokensCeiling: 1024, categories: [{ key: 'chat', label: 'Chat' }],
      job: { run_id: 0, status: 'idle', backend: '', total: 0, done: 0, current: '', error: '', unit: '', lines: [], pct: 0, elapsed: 0, eta: 0, active: false }, runs: [] });
    if (p === '/api/model-manager/prompts') return json({ prompts: [] });
    if (p.startsWith('/api/model-manager/') || p.startsWith('/api/models/') || p === '/api/sampling-settings' || p === '/api/reasoning-settings') return json({});
    return route.continue();
  });
}

async function preparePage(browser, { width, height, family = 'editorial', theme = 'dark', session = {} }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript(([fam, th, ss]) => {
    try { localStorage.setItem('noevia:theme-family', fam); localStorage.setItem('cowork-theme', th); for (const [k, v] of Object.entries(ss)) sessionStorage.setItem(k, v); } catch { /* ignore */ }
  }, [family, theme, session]);
  return page;
}

async function openModels(page, section) {
  await page.goto(`http://localhost:${PORT}/models`);
  const root = page.locator('.model-manager-page');
  await root.waitFor();
  if (section) await root.getByRole('tab', { name: section, exact: true }).click();
  return root;
}

async function openModelDialog(page) {
  await page.goto(`http://localhost:${PORT}`);
  const choose = page.getByRole('button', { name: /^Choose model/ }).first();
  await choose.waitFor();
  await choose.click();
  const dialog = page.locator('dialog.model-dialog-backdrop[open]');
  await dialog.waitFor();
  return dialog;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS models-routing: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL models-routing: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); }
  };
  try {
    await check('#1008 Models & routing has four sections, not eight tabs', async () => {
      const page = await preparePage(browser, { width: 1440, height: 950 });
      await stub(page, scenario());
      const root = await openModels(page);
      const tabs = await root.getByRole('tab').allInnerTexts();
      assert.deepEqual(tabs.map((s) => s.trim()), ['Models', 'Routing', 'Performance', 'Advanced']);
      await page.close();
    });

    await check('#1008 an old saved tab (Benchmarks) opens its new home with the panel open', async () => {
      const page = await preparePage(browser, { width: 1440, height: 950, session: { 'noevia-models-tab': 'benchmarks' } });
      await stub(page, scenario());
      const root = await openModels(page);
      assert.equal(await root.getByRole('tab', { name: 'Performance', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await root.locator('details[data-panel="benchmarks"]').evaluate((d) => d.open), true);
      await page.close();
    });

    await check('#1008 Sign in with ChatGPT is in Models & routing → Routing', async () => {
      const page = await preparePage(browser, { width: 1440, height: 950 });
      await stub(page, scenario());
      const root = await openModels(page, 'Routing');
      await root.getByText('Sign in with ChatGPT').first().waitFor({ timeout: 5000 });
      await page.close();
    });

    await check('#1009 the cloud model fields list the provider\'s models, search, refresh and take a custom id', async () => {
      const state = scenario();
      const page = await preparePage(browser, { width: 1440, height: 950 });
      await stub(page, state);
      const root = await openModels(page, 'Routing');
      const fast = root.getByRole('combobox', { name: 'Cloud model for Fast' });
      await fast.waitFor({ timeout: 5000 });
      await root.getByText('4 models listed by Synthetic Cloud.').waitFor({ timeout: 5000 });
      await fast.click();
      const list = root.getByRole('listbox', { name: 'Cloud model for Fast' });
      assert.deepEqual((await list.getByRole('option').allInnerTexts()).map((s) => s.trim()), LISTED, 'every listed model is offered');
      await fast.fill('code');
      assert.deepEqual((await list.getByRole('option').allInnerTexts()).map((s) => s.trim()), ['syn-code-3', 'Use “code”'], 'typing filters, and offers the typed text');
      await list.getByRole('option', { name: 'syn-code-3' }).click();
      assert.equal(await fast.inputValue(), 'syn-code-3');
      const code = root.getByRole('combobox', { name: 'Cloud model for Code (optional)' });
      await code.fill('my-own-model');
      await code.press('Enter');
      assert.equal(await code.inputValue(), 'my-own-model', 'a custom id stays');
      await root.getByRole('button', { name: 'Refresh list' }).click();
      await page.waitForFunction(() => true);
      await root.getByText('4 models listed by Synthetic Cloud.').waitFor();
      assert.ok(state.modelListCalls.includes('?refresh=1'), `refresh asks the server to refetch: ${JSON.stringify(state.modelListCalls)}`);
      await root.getByRole('button', { name: 'Save routing mode' }).click();
      await root.getByText('Routing mode saved.').waitFor();
      assert.deepEqual(state.routingPuts.at(-1).cloud, { providerId: 'prov-syn', fast: 'syn-code-3', smart: 'syn-smart-2', code: 'my-own-model' });
      await page.close();
    });

    await check('#1006 the model dialog has no tool list; Tools Automatic hides the checkboxes and Manual shows them', async () => {
      const state = scenario();
      const page = await preparePage(browser, { width: 1440, height: 950 });
      await stub(page, state);
      const dialog = await openModelDialog(page);
      assert.equal(await dialog.locator('input[type="checkbox"]').count(), 0, 'no tool checkboxes in the model dialog');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Add files and tools/ }).click();
      const menu = page.getByRole('region', { name: /files and tools/i });
      const toolsMode = menu.getByRole('radiogroup', { name: 'How this chat picks its tools' });
      await toolsMode.waitFor({ timeout: 5000 });
      assert.equal(await toolsMode.getByRole('radio', { name: 'Automatic' }).getAttribute('aria-checked'), 'true');
      assert.equal(await menu.getByRole('menuitemcheckbox').count(), 0, 'Automatic: no tool checkboxes');
      await toolsMode.getByRole('radio', { name: 'Manual' }).click();
      await menu.getByRole('menuitemcheckbox').first().waitFor({ timeout: 5000 });
      assert.equal(await menu.getByRole('menuitemcheckbox').count(), 2, 'Manual: the tool list');
      assert.equal(state.configPatches.at(-1).toolsMode, 'manual', 'saved on the chat');
      await page.close();
    });

    await check('#1007 Auto in the model dialog offers the same routing choices as Settings and saves them per chat', async () => {
      const state = scenario();
      let page = await preparePage(browser, { width: 1440, height: 950 });
      await stub(page, state);
      const root = await openModels(page, 'Routing');
      const settingsChoice = root.getByTestId('routing-mode-choice');
      await settingsChoice.waitFor({ timeout: 5000 });
      const settingsModes = (await settingsChoice.locator('fieldset').first().locator('label').allInnerTexts()).map((s) => s.trim()).slice(1);
      await page.close();
      page = await preparePage(browser, { width: 1440, height: 950 });
      await stub(page, state);
      const dialog = await openModelDialog(page);
      const pickerChoice = dialog.getByTestId('routing-mode-choice');
      await pickerChoice.waitFor({ timeout: 5000 });
      const labels = (await pickerChoice.locator('fieldset').first().locator('label').allInnerTexts()).map((s) => s.trim());
      assert.equal(labels[0], 'Same as my default (Cloud)');
      assert.deepEqual(labels.slice(1), settingsModes, 'the same modes as Settings');
      await pickerChoice.getByRole('radio', { name: 'Hybrid' }).check();
      await pickerChoice.getByRole('radio', { name: 'Always local' }).waitFor();
      await pickerChoice.getByRole('radio', { name: 'Always local' }).check();
      await dialog.getByText('Saved for this chat.').waitFor();
      assert.deepEqual(state.configPatches.at(-1), { routingMode: { mode: 'hybrid', whenSensitive: 'local' } });
      await page.keyboard.press('Escape');
      const again = await openModelDialog(page);
      const choice = again.getByTestId('routing-mode-choice');
      await choice.waitFor();
      assert.equal(await choice.getByRole('radio', { name: 'Hybrid' }).isChecked(), true, 'persisted for this chat');
      assert.equal(await choice.getByRole('radio', { name: 'Always local' }).isChecked(), true);
      await choice.getByRole('radio', { name: /^Same as my default/ }).check();
      await again.getByText('Saved for this chat.').waitFor();
      assert.deepEqual(state.configPatches.at(-1), { routingMode: null });
      await page.close();
    });

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      for (const family of ['editorial', 'contemporary', 'glass']) for (const theme of ['light', 'dark']) for (const [device, width, height] of [['desktop', 1440, 950], ['phone', 390, 844]]) {
        const tag = `${family}-${theme}-${device}`;
        let page = await preparePage(browser, { width, height, family, theme });
        await stub(page, scenario());
        try {
          const root = await openModels(page);
          const routing = root.getByRole('tab', { name: 'Routing', exact: true });
          if (await routing.count()) await routing.click(); else await root.getByRole('tab', { name: 'Routing' }).first().click();
          await page.waitForTimeout(600);
          await page.screenshot({ path: `${SHOTS}/settings-routing-${tag}.png`, fullPage: true });
          const fast = root.getByRole('combobox', { name: 'Cloud model for Fast' });
          if (await fast.count()) { await fast.scrollIntoViewIfNeeded(); await fast.click(); await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/cloud-models-${tag}.png` }); }
          await page.close();
          page = await preparePage(browser, { width, height, family, theme });
          await stub(page, scenario());
          await openModelDialog(page);
          await page.waitForTimeout(600);
          await page.screenshot({ path: `${SHOTS}/model-dialog-${tag}.png` });
          await page.keyboard.press('Escape');
          await page.getByRole('button', { name: /^Add files and tools/ }).click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${SHOTS}/composer-tools-${tag}.png` });
        } catch (e) { console.log(`shot ${tag}: ${String(e.message).split('\n')[0]}`); }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`models-routing: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
