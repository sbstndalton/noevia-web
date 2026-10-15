'use strict';
// #1862: Settings → Models → Routing: a saved cloud model the ChatGPT account's refreshed list no longer holds is flagged
// ("gpt-6.1-sol (no longer offered)"), kept as saved, not changed; and a Refresh press makes exactly one models request
// (no second GET /api/providers/chatgpt-oauth/models a few seconds later).
// Synthetic APIs only. Fails on a build without the change (no note at all), passes with it.
//   PLAYWRIGHT_MODULE=<playwright> QA_DIST=<dist> [QA_SHOTS=<dir>] node qa/routing-stale-model-1862.cjs
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const PORT = Number(process.env.QA_PORT || 31862);
const SHOTS = process.env.QA_SHOTS || '';
const LISTED = ['gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.6-mini'];

(async () => {
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  try {
    for (const [width, height, theme] of [[2000, 1250, 'light'], [2000, 1250, 'dark'], [390, 844, 'light'], [390, 844, 'dark']]) {
      const tag = `${width} px ${theme}`;
      const page = await browser.newPage(withLocale({ viewport: { width, height } }));
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(([th]) => { try { localStorage.setItem('cowork-theme', th); } catch { /* ignore */ } }, [theme]);
      const modelCalls = [];
      let saved = { providerId: 'chatgpt-oauth', fast: 'gpt-5.6-mini', smart: 'gpt-6.1-sol', code: '' };
      await page.route('**/api/**', (route) => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
        const json = (b, status = 200) => route.fulfill({ status, json: b });
        if (/\/models$/.test(p) && /chatgpt/.test(p)) modelCalls.push(`${p}${url.search}`);
        if (p === '/api/features') return json({ flags: { previews: false, chatgptOAuth: true, routingModes: true } });
        if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
        if (/^\/api\/chats\/[^/]+\/context$/.test(p)) return json({ project: { id: 'p-syn', name: 'Synthetic', routing: 'auto', files: [], assets: [], toolboxes: ['core'], toolsMode: 'auto' } });
        if (p === '/api/providers') return json({ providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }, { id: 'chatgpt-oauth', label: 'ChatGPT', baseUrl: 'https://chatgpt.invalid/backend-api/codex', isDefault: false, kind: 'chatgpt-oauth', external: true, connection: 'connected' }] });
        if (p === '/api/providers/chatgpt-oauth/models' || p === '/api/providers/chatgpt/models') return json({ models: LISTED, cached: !url.searchParams.get('refresh'), fetchedAt: 1 });
        if (p === '/api/providers/chatgpt') return json({ state: 'connected', providerId: 'chatgpt-oauth', external: true, account: { email: 'syn@example.invalid', plan: 'plus' } });
        if (p === '/api/routing-mode' && m === 'PUT') { saved = { ...saved, ...(req.postDataJSON()?.cloud || {}) }; return json({ enabled: true, storedMode: 'cloud', mode: 'cloud', whenSensitive: 'ask', cloud: saved, allowed: ['local', 'cloud', 'hybrid'], admin: true }); }
        if (p === '/api/routing-mode' && m === 'GET') return json({ enabled: true, storedMode: 'cloud', mode: 'cloud', whenSensitive: 'ask', cloud: saved, allowed: ['local', 'cloud', 'hybrid'], admin: true });
        if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: 'Synthetic-Chat', smart: 'Synthetic-Chat' }, missing: [] });
        if (p === '/api/routing-default') return json({ routing: 'auto' });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
        if (p === '/api/models/installed') return json([{ name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, source: 'cache', status: 'loaded' }]);
        if (p === '/api/models/inference-budget') return json({}, 404);
        if (p === '/api/toolboxes') return json({ toolboxes: [], mcp: { configured: false, servers: [] } });
        if (p.startsWith('/api/model-manager/') || p.startsWith('/api/models/') || p === '/api/sampling-settings' || p === '/api/reasoning-settings') return json({});
        return route.continue();
      });
      const check = async (name, fn) => { try { await fn(); console.log(`PASS routing-stale-1862: ${tag}: ${name}`); } catch (e) { failed++; console.log(`FAIL routing-stale-1862: ${tag}: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); } };
      await page.goto(`http://localhost:${PORT}/models`);
      const root = page.locator('.model-manager-page'); await root.waitFor();
      await root.getByRole('tab', { name: 'Routing', exact: true }).click();
      await root.getByText('3 models listed by ChatGPT.').waitFor({ timeout: 8000 });
      await check('opening the Routing tab asks for the ChatGPT account list once, not once per component', async () => {
        await page.waitForTimeout(1500);
        console.log('   (open) models calls:', JSON.stringify(modelCalls));
        assert.equal(modelCalls.length, 1, `models calls: ${modelCalls.join(', ')}`);
      });
      const flag = root.getByTestId('model-no-longer-offered');
      await check('a saved Smart model missing from the refreshed list is flagged, and kept', async () => {
        await flag.waitFor({ timeout: 5000 });
        assert.equal(await flag.count(), 1, 'only the Smart model is flagged (Fast is listed)');
        assert.match(await flag.innerText(), /^gpt-6\.1-sol \(no longer offered\)/);
        assert.equal(await root.getByRole('combobox', { name: 'Cloud model for Smart' }).inputValue(), 'gpt-6.1-sol');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
        if (SHOTS) { await flag.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/1862-no-longer-offered-${width}-${theme}.png` }); }
      });
      await check('one Refresh press makes one models request, and none follows', async () => {
        modelCalls.length = 0;
        await root.getByRole('button', { name: 'Refresh list' }).click();
        await root.getByTestId('routing-refresh-note').filter({ hasText: 'Model list updated' }).waitFor({ timeout: 5000 });
        await page.waitForTimeout(10500);
        assert.deepEqual(modelCalls, ['/api/providers/chatgpt-oauth/models?refresh=1']);
      });
      await check('choosing a listed model clears the flag', async () => {
        const smart = root.getByRole('combobox', { name: 'Cloud model for Smart' });
        await smart.fill('gpt-6-sol');
        await root.getByRole('option', { name: 'gpt-6-sol' }).first().click().catch(() => undefined);
        await flag.waitFor({ state: 'detached', timeout: 3000 });
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  console.log(failed ? `routing-stale-1862: ${failed} FAILED` : 'routing-stale-1862: all passed');
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
