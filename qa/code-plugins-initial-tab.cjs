// #464 — Code sidebar Plugins must open the Plugins tab of the shared Customise view.
// The main Customise entry keeps its Connectors default. Synthetic APIs only.
// QA_DIST=/tmp/noevia-ui-dist QA_SCREENSHOTS=/tmp/noevia-ui-shots \
//   node qa/code-plugins-initial-tab.cjs
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const port = Number(process.env.QA_PORT || 31554);
const shots = process.env.QA_SCREENSHOTS || '/tmp/noevia-code-plugins-tab';
const user = { id: 'synthetic-plugins-admin', username: 'synthetic-admin', displayName: 'Synthetic Admin', role: 'admin', diaryEnabled: false, onboarded: true };

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage(withLocale({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }));
      page.on('pageerror', e => errors.push(`${width}/${theme}: ${e.message}`));
      await page.addInitScript(theme => {
        localStorage.setItem('cowork-theme', theme);
        localStorage.setItem('noevia:feature-flags', JSON.stringify({ previews: true, codeHarness: true }));
      }, theme);
      await page.route('**/api/auth/session', route => route.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/profile', route => route.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/features', route => route.fulfill({ json: { flags: { previews: true, codeHarness: true } } }));
      await page.goto(`http://localhost:${port}/code`);
      await page.locator('.coding-main').waitFor();
      if (width <= 519) await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('navigation', { name: 'Coding navigation' }).getByRole('button', { name: 'Plugins' }).click();
      const code = page.locator('.coding-main');
      await code.getByRole('heading', { name: 'Customise' }).waitFor();
      const tabs = code.getByRole('radiogroup', { name: 'Customise' });
      const selected = await tabs.getByRole('radio', { name: 'Plugins' }).getAttribute('aria-checked');
      await page.screenshot({ path: path.join(shots, `code-${width}-${theme}.png`) });
      assert.equal(await page.locator('.coding-header span').first().textContent(), 'Plugins');
      assert.equal(selected, 'true', `${width}/${theme}: Code Plugins selected ${await tabs.locator('[aria-checked="true"]').textContent()}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}/${theme}: horizontal overflow`);
      await page.goto(`http://localhost:${port}/customise`);
      const mainTabs = page.locator('.plugins-view').getByRole('radiogroup', { name: 'Customise' });
      await mainTabs.waitFor();
      assert.equal(await mainTabs.getByRole('radio', { name: 'Connectors' }).getAttribute('aria-checked'), 'true', `${width}/${theme}: main Customise default changed`);
      await page.screenshot({ path: path.join(shots, `customise-${width}-${theme}.png`) });
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS Code Plugins initial tab and main Customise default: 1440/768/390 light/dark');
  } finally {
    await browser.close(); await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
