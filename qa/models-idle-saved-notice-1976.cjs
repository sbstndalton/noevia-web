'use strict';
// noevia#1976: the "Unload idle chat models" card must not say "Saved — applies after the next reload."
// on load when nothing was saved (the server reports the default, applied: false because the router's
// file carries no key). The notice shows only for a saved administrator value the router has not
// picked up, or after a save in this session; and then the source line must not say "Using the default".
// Mocked API only: no server, no model.
//   QA_DIST=<dist dir> QA_CORE_SERVER=<core server/> [QA_SHOTS=<dir>] [QA_SHOT=<file name>] node qa/models-idle-saved-notice-1976.cjs
const path = require('node:path');
const assert = require('node:assert/strict');
const { openModelsTab } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);

const PORT = Number(process.env.QA_PORT || 31976);
const SHOTS = process.env.QA_SHOTS;
const admin = { id: 'qa-admin', username: 'qa-admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true };
const view = (o) => ({ seconds: 1800, source: 'default', fallbackSeconds: 1800, fallbackSource: 'default', defaultSeconds: 1800, minSeconds: 300, maxSeconds: 86400, applied: false, ...o });

async function open(browser, server) {
  const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 1100 } }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (pathname === '/api/profile' || pathname === '/api/auth/session') return route.fulfill({ json: { user: admin, passkeys: [] } });
    if (pathname === '/api/models/capabilities') return route.fulfill({ json: { kind: 'llamacpp', admin: true, presets: true, download: true, runtimeOptions: false, modelManagement: true } });
    if (pathname === '/api/models/idle-unload') {
      if (req.method() === 'PUT') { const { seconds } = req.postDataJSON(); server.puts.push(seconds); server.current = view(seconds === null ? {} : { seconds, source: 'setting' }); return route.fulfill({ json: { ...server.current, apply: { state: 'pending', loaded: ['Qwen3.5-9B'] }, applied: false } }); }
      return route.fulfill({ json: server.current });
    }
    if (pathname === '/api/models/inference-budget') return route.fulfill({ status: 404, json: {} });
    if (pathname.startsWith('/api/model-manager/')) return route.fulfill({ json: { backends: [], jobs: [], models: [], unregistered: [], sections: [], revision: 'r1' } });
    if (pathname.startsWith('/api/models/')) return route.fulfill({ json: [] });
    return route.continue();
  });
  await page.goto(`http://localhost:${PORT}/models`);
  await openModelsTab(page, 'Performance');
  return { page, errors };
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  let failed = 0;
  const check = async (label, fn) => { try { await fn(); console.log(`PASS 1976: ${label}`); } catch (e) { failed++; console.log(`FAIL 1976: ${label}\n  ${String(e.message).split('\n').slice(0, 5).join('\n  ')}`); } };
  try {
    await check('default value, router not known to match: no "Saved" notice, no Apply now', async () => {
      const server = { puts: [], current: view({}) };
      const { page, errors } = await open(browser, server);
      const card = page.getByRole('region', { name: 'Unload idle chat models' });
      await card.waitFor({ timeout: 15000 });
      await card.getByText('Using the default.').waitFor({ timeout: 3000 });
      if (SHOTS) { await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, process.env.QA_SHOT || '1976.png') }); }
      assert.equal(await card.getByText(/Saved — applies after the next reload/).count(), 0, 'a Saved notice shows although nothing was saved');
      assert.equal(await card.getByRole('button', { name: 'Apply now' }).count(), 0);
      assert.deepEqual(errors, []); await page.close();
    });
    await check('a saved value the router has not picked up shows the notice, and never "Using the default"', async () => {
      const server = { puts: [], current: view({ seconds: 3600, source: 'setting' }) };
      const { page } = await open(browser, server);
      const card = page.getByRole('region', { name: 'Unload idle chat models' });
      await card.getByTestId('idle-pending').filter({ hasText: 'Saved — applies after the next reload.' }).waitFor({ timeout: 15000 });
      await card.getByRole('button', { name: 'Apply now' }).waitFor({ timeout: 2000 });
      assert.equal(await card.getByText('Using the default.').count(), 0);
      await page.close();
    });
    await check('saving in this session shows the notice; the notice and Apply now go away after resetting to the default', async () => {
      const server = { puts: [], current: view({}) };
      const { page } = await open(browser, server);
      const card = page.getByRole('region', { name: 'Unload idle chat models' });
      await card.waitFor({ timeout: 15000 });
      await card.getByRole('combobox', { name: 'Unload after' }).selectOption('3600');
      await card.getByRole('button', { name: 'Save' }).click();
      await card.getByTestId('idle-pending').waitFor({ timeout: 5000 });
      assert.equal(await card.getByText('Using the default.').count(), 0);
      await card.getByRole('button', { name: 'Use deployment default' }).click();
      await card.getByText('Using the default.').waitFor({ timeout: 5000 });
      assert.equal(await card.getByTestId('idle-pending').count(), 0, 'a reset is not a pending save');
      assert.equal(await card.getByRole('button', { name: 'Apply now' }).count(), 0);
      assert.deepEqual(server.puts, [3600, null]);
      await page.close();
    });
  } finally { await browser.close(); await fixture.close(); }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
