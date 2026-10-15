'use strict';
// #1857: Settings → Models → Routing → "Refresh list" says what happened, with the same transient note as the model
// popup's refresh (#1814): updated / wait (throttled) / empty (keeps the list) / failed; each clears by itself.
// Synthetic APIs only. Fails on a build without the change (no note at all), passes with it.
//   PLAYWRIGHT_MODULE=<playwright> QA_DIST=<dist> [QA_SHOTS=<dir>] node qa/routing-refresh-note-1857.cjs
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const PORT = Number(process.env.QA_PORT || 31857);
const SHOTS = process.env.QA_SHOTS || '';
const LISTED = ['syn-fast-1', 'syn-smart-2', 'syn-code-3', 'syn-vision-4'];

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
      let answer = 'updated';
      await page.route('**/api/**', (route) => {
        const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
        const json = (b, status = 200) => route.fulfill({ status, json: b });
        if (p === '/api/features') return json({ flags: { previews: false, chatgptOAuth: true, routingModes: true } });
        if (p === '/api/profile' || p === '/api/auth/session') return json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] });
        if (/^\/api\/chats\/[^/]+\/context$/.test(p)) return json({ project: { id: 'p-syn', name: 'Synthetic', routing: 'auto', files: [], assets: [], toolboxes: ['core'], toolsMode: 'auto' } });
        if (p === '/api/providers') return json({ providers: [{ id: 'default', label: 'Native', baseUrl: 'http://synthetic.invalid/v1', managed: true, isDefault: true }, { id: 'prov-syn', label: 'Synthetic Cloud', baseUrl: 'https://cloud.synthetic.invalid/v1', apiKeyMasked: '…0000' }] });
        if (p === '/api/providers/prov-syn/models') {
          if (!url.searchParams.get('refresh')) return json({ models: LISTED, cached: true });
          if (answer === 'updated') return json({ models: [...LISTED, 'syn-new-5'], cached: false });
          if (answer === 'wait') return json({ models: LISTED, cached: true, throttled: true });
          if (answer === 'empty') return json({ models: [], cached: false });
          return json({ error: 'upstream down' }, 502);
        }
        if (p === '/api/providers/chatgpt') return json({ state: 'disconnected', providerId: 'chatgpt-oauth', external: true });
        if (p === '/api/routing-mode' && m === 'GET') return json({ enabled: true, storedMode: 'cloud', mode: 'cloud', whenSensitive: 'ask', cloud: { providerId: 'prov-syn', fast: '', smart: 'syn-smart-2', code: '' }, allowed: ['local', 'cloud', 'hybrid'], admin: true });
        if (p === '/api/auto-roles') return json({ configured: true, roles: { fast: 'Synthetic-Chat', smart: 'Synthetic-Chat' }, missing: [] });
        if (p === '/api/routing-default') return json({ routing: 'auto' });
        if (p === '/api/models/capabilities') return json({ kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true });
        if (p === '/api/models/installed') return json([{ name: 'Synthetic-Chat', labels: [], loaded: true, sizeGB: 3.3, source: 'cache', status: 'loaded' }]);
        if (p === '/api/models/inference-budget') return json({}, 404);
        if (p === '/api/toolboxes') return json({ toolboxes: [], mcp: { configured: false, servers: [] } });
        if (p.startsWith('/api/model-manager/') || p.startsWith('/api/models/') || p === '/api/sampling-settings' || p === '/api/reasoning-settings') return json({});
        return route.continue();
      });
      const check = async (name, fn) => { try { await fn(); console.log(`PASS routing-refresh-1857: ${tag}: ${name}`); } catch (e) { failed++; console.log(`FAIL routing-refresh-1857: ${tag}: ${name}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`); } };
      await page.goto(`http://localhost:${PORT}/models`);
      const root = page.locator('.model-manager-page'); await root.waitFor();
      await root.getByRole('tab', { name: 'Routing', exact: true }).click();
      await root.getByText('4 models listed by Synthetic Cloud.').waitFor({ timeout: 8000 });
      const refresh = root.getByRole('button', { name: 'Refresh list' });
      const note = root.getByTestId('routing-refresh-note');
      for (const [mode, text, count] of [['updated', 'Model list updated', 5], ['wait', 'Try again in a few seconds', 4], ['empty', 'No models returned. Kept the previous list', 4], ['failed', "Couldn't refresh the model list", 4]]) {
        await check(`${mode}: the note shows, the list is right, and the note clears by itself`, async () => {
          answer = mode;
          await refresh.click();
          await note.filter({ hasText: text }).waitFor({ timeout: 5000 });
          await root.getByText(`${count} models listed by Synthetic Cloud.`).waitFor({ timeout: 5000 });
          if (SHOTS) { await refresh.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/1857-${mode}-${width}-${theme}.png` }); }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
          await note.filter({ hasText: text }).waitFor({ state: 'detached', timeout: 9000 }).catch(async () => { assert.equal((await note.innerText()).trim(), '', 'the note cleared'); });
          assert.equal((await note.innerText()).trim(), '');
        });
        if (mode === 'updated') { answer = 'updated'; }
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await fixture.close(); }
  console.log(failed ? `routing-refresh-1857: ${failed} FAILED` : 'routing-refresh-1857: all passed');
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
