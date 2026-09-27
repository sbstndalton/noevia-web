// #466: a delayed synthetic backend probe must remain pending until it settles.
// No real model, inference, or settings endpoint is contacted.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/sebastiandalton/noevia-local-test/node_modules/playwright-core');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 31466;
const OUT = process.env.QA_SCREENSHOTS;
const backend = { name: 'synthetic-engine', found: true, status: 'running', loaded_model: null, probe_error: null, last_restart_error: null };

async function check(browser, width, theme, result) {
  const page = await browser.newPage(withLocale({ viewport: { width, height: 950 } }));
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let resolveRequest;
  const requestStarted = new Promise(resolve => { resolveRequest = resolve; });
  let heldRoute;
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/profile' || pathname === '/api/auth/session') {
      return route.fulfill({ json: { user: { id: 'synthetic-admin', username: 'fixture', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] } });
    }
    if (pathname === '/api/model-manager/backends') {
      heldRoute = route;
      resolveRequest();
      return;
    }
    if (pathname === '/api/models/installed') return route.fulfill({ json: [] });
    return route.continue();
  });
  try {
    await page.goto(`http://localhost:${PORT}/models`);
    await page.evaluate(selected => document.documentElement.setAttribute('data-theme', selected), theme);
    await page.getByRole('tab', { name: 'Overview' }).click();
    await requestStarted;
    const state = page.locator('.mm-loader-state');
    await state.waitFor();
    assert.equal(await state.innerText(), 'Checking model loader…', `${width}/${theme}/${result}: initial probe is pending`);
    assert.equal(await page.locator('.mm-loader-row .model-dot.down').count(), 0, 'pending is not an unavailable-status dot');
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `models-loader-${width}-${theme}-${result}-pending.png`) });
    }
    if (result === 'success') await heldRoute.fulfill({ json: { backends: [backend] } });
    else if (result === 'failure') await heldRoute.fulfill({ status: 503, json: { error: 'Synthetic probe unavailable' } });
    else await heldRoute.fulfill({ json: {} });
    heldRoute = null;
    await page.waitForFunction(expected => document.querySelector('.mm-loader-state')?.textContent?.trim() === expected,
      result === 'success' ? 'synthetic-engine running' : 'Health unavailable');
    assert.equal(await state.innerText(), result === 'success' ? 'synthetic-engine running' : 'Health unavailable');
    assert.equal(await page.locator('.mm-loader-row .model-dot.down').count(), result === 'success' ? 0 : 1);
    const help = page.getByText('Could not check the model loader. Check again or open logs.');
    assert.equal(await help.count(), result === 'success' ? 0 : 1);
    assert.ok(await page.locator('.model-manager-page').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}/${theme}/${result}: horizontal overflow`);
    if (OUT) await page.screenshot({ path: path.join(OUT, `models-loader-${width}-${theme}-${result}-settled.png`) });
    assert.deepEqual(pageErrors, []);
  } finally {
    if (heldRoute) await heldRoute.fulfill({ status: 503, json: { error: 'Synthetic cleanup' } }).catch(() => undefined);
    await page.close();
  }
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
      for (const result of ['success', 'failure', 'malformed']) await check(browser, width, theme, result);
    }
    console.log('PASS #466: pending, successful, failed and malformed loader probes at 1440/768/390 in light/dark.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
