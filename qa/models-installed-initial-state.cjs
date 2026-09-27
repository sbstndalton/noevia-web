// #475: the shared installed-model list is unknown until its first request settles.
// All responses are synthetic; the fixture performs no model, inference or settings action.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/sebastiandalton/noevia-local-test/node_modules/playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31475;
const OUT = process.env.QA_SCREENSHOTS;
const installed = [{ name: 'Synthetic-9B-Q5', loaded: true, labels: ['vision'], sizeGB: 6.6, status: 'loaded' }];

async function check(browser, surface, width, theme, outcome) {
  const page = await browser.newPage(withLocale({ viewport: { width, height: 950 } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [], held = [];
  let released = false;
  page.on('pageerror', error => errors.push(error.message));
  const result = () => outcome === 'failure'
    ? { status: 503, json: { error: 'Synthetic unavailable' } }
    : { json: outcome === 'success' ? installed : [] };
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/profile' || pathname === '/api/auth/session') {
      return route.fulfill({ json: { user: { id: 'synthetic-admin', username: 'fixture', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true }, passkeys: [] } });
    }
    if (pathname === '/api/models/installed') {
      if (!released) { held.push(route); return; }
      return route.fulfill(result());
    }
    if (pathname === '/api/model-manager/backends') return route.fulfill({ json: { backends: [{ name: 'synthetic-engine', found: true, status: 'running', loaded_model: null, probe_error: null, last_restart_error: null }] } });
    return route.continue();
  });
  try {
    await page.goto(`http://localhost:${PORT}${surface === 'overview' ? '/models' : '/settings/models'}`);
    await page.evaluate(selected => document.documentElement.setAttribute('data-theme', selected), theme);
    if (surface === 'overview') await page.getByRole('tab', { name: 'Overview' }).click();
    const panel = surface === 'overview' ? page.locator('section[aria-labelledby="mm-quality"]') : page.locator('.mm-summary');
    await panel.waitFor();
    assert.ok(held.length > 0, `${surface}/${width}/${theme}: installed-model request is held`);
    if (surface === 'overview') {
      assert.equal(await panel.getByText('Loading models…').count(), 1, 'Overview announces pending models');
      assert.equal(await panel.getByText('No models are installed yet.').count(), 0, 'Overview does not claim empty while pending');
    } else {
      const row = panel.locator('.model-row', { hasText: 'Installed' });
      assert.equal(await row.locator('.model-role').innerText(), 'Loading…', 'Settings summary announces pending models');
    }
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `installed-${surface}-${width}-${theme}-${outcome}-pending.png`) });
    }
    released = true;
    for (const route of held) await route.fulfill(result());
    const expected = surface === 'overview'
      ? outcome === 'success' ? 'Synthetic-9B-Q5' : outcome === 'empty' ? 'No models are installed yet.' : 'Model manager unavailable or disabled.'
      : outcome === 'success' ? '1 model · loaded: Synthetic-9B-Q5' : outcome === 'empty' ? '0 models · none loaded' : 'Not available';
    await panel.getByText(expected, { exact: surface === 'settings' }).waitFor();
    if (surface === 'overview') {
      assert.equal(await panel.getByText('Loading models…').count(), 0);
      if (outcome === 'failure') assert.equal(await panel.getByText('No models are installed yet.').count(), 0);
    } else {
      assert.equal(await panel.locator('.model-row', { hasText: 'Installed' }).locator('.model-role').innerText(), expected);
    }
    if (OUT) await page.screenshot({ path: path.join(OUT, `installed-${surface}-${width}-${theme}-${outcome}-settled.png`) });
    assert.ok(await page.locator('.app-main').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${surface}/${width}/${theme}/${outcome}: horizontal overflow`);
    assert.deepEqual(errors, []);
  } finally {
    for (const route of held) await route.fulfill(result()).catch(() => undefined);
    await page.close();
  }
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const surface of ['overview', 'settings']) for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
      for (const outcome of ['empty', 'success', 'failure']) await check(browser, surface, width, theme, outcome);
    }
    console.log('PASS #475: pending/empty/success/failure at Overview and Settings, 1440/768/390 light/dark.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
