'use strict';
// Screenshots of Settings -> Experimental with the Tool gate toggle, against the synthetic
// experimental fixture (qa/experimental-fixture.cjs on :31240, real feature routes, no model).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { withLocale } = require('./qa-locale.cjs');
const out = process.env.SHOTS_DIR || '/tmp/toolgate-shots';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    for (const width of [375, 1440]) {
      const page = await browser.newPage(withLocale({ viewport: { width, height: width === 375 ? 812 : 900 } }));
      await page.goto('http://localhost:31240'); await page.getByPlaceholder('Message noevia…').waitFor();
      await page.getByTitle('Settings', { exact: true }).click();
      const settings = page.getByRole('region', { name: 'Settings', exact: true }); await settings.waitFor();
      await settings.locator('.settings-navigation').getByRole('button', { name: 'Experimental', exact: true }).click();
      const row = settings.getByText('Tool gate', { exact: true }); await row.waitFor();
      await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/features-tool-gate-${width}.png` });
      console.log('saved', width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
