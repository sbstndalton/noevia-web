// Synthetic settings navigation: responsive layouts, search, focus and themes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

(async () => {
  const fixture = createFixture(31420);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [375, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      await page.goto('http://localhost:31420');
      await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
      await page.getByTitle('Settings', { exact: true }).click();
      const settings = page.getByRole('region', { name: 'Settings', exact: true });
      await settings.getByRole('button', { name:'Appearance & language',exact: true }).click();
      await settings.getByRole('heading', { name:'Appearance & language',exact: true }).waitFor();
      for (const theme of ['light', 'dark']) {
        await settings.getByRole('button', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click();
        await page.waitForTimeout(350);
        assert.ok(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${width}/${theme}: overflow`);
        await page.screenshot({ path: `/tmp/noevia-ui-settings-${width}-${theme}.png` });
      }
      if (width <= 820) {
        await settings.getByRole('button', { name: 'All settings', exact: true }).click();
        await page.waitForTimeout(250);
        assert.ok(await settings.getByRole('button', { name:'Appearance & language',exact: true }).evaluate(el => el === document.activeElement));
        await settings.getByLabel('Search settings').fill('Connected apps');
        await settings.getByRole('button', { name: 'Connected apps', exact: true }).click();
        await settings.getByRole('heading', { name: 'Connectors', exact: true }).waitFor();
        assert.ok(await page.locator('.settings-detail-scroll').evaluate(el => el === document.activeElement));
      }
      await page.close();
    }
    console.log('PASS settings navigation: 375/768/1440, light/dark, mobile back/focus and searchable Connectors.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
