'use strict';
// sbstndalton/noevia#2400: when GET /api/account/retention fails, Settings → Your data and privacy showed the correct error
// but the disabled "Delete old chats" select still read "Never", which reads as the setting being off. It now shows an
// "unknown" placeholder (no period chosen) until the setting has loaded. Fails on a build of main, passes with the change.
//   see ui-batch-harness.cjs for the environment
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

run('retention-unknown-2400', Number(process.env.QA_PORT || 32400), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: a failed load reads "Not loaded", never "Never"`, async () => {
      const page = await themedPage(browser, view);
      try {
        await page.route('**/api/account/retention', (route) => route.fulfill({ status: 500, json: { error: 'Synthetic failure' } }));
        await page.goto(`${origin}/settings/data`);
        await page.getByText('The retention setting could not be loaded.').waitFor({ timeout: 15000 });
        const select = page.getByRole('combobox', { name: 'Delete old chats' });
        assert.equal(await select.isDisabled(), true, 'the select stays disabled');
        assert.equal(await select.evaluate((el) => el.selectedOptions[0]?.textContent), 'Not loaded', 'it shows the placeholder');
        await shot(page, `retention-load-error-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
  await check('a loaded setting still reads Never, and a chosen period reads as chosen', async () => {
    const page = await themedPage(browser, VIEWS[2]);
    try {
      await page.route('**/api/account/retention', (route) => route.fulfill({ json: { days: 90, periods: [30, 90, 365], preview: { 30: 0, 90: 0, 365: 0 } } }));
      await page.goto(`${origin}/settings/data`);
      const select = page.getByRole('combobox', { name: 'Delete old chats' });
      await page.waitForFunction(() => { const s = document.querySelector('select[aria-label="Delete old chats"]'); return s && !s.disabled; }, null, { timeout: 15000 });
      assert.equal(await select.evaluate((el) => el.selectedOptions[0]?.textContent), 'After 90 days');
      assert.equal(await select.locator('option', { hasText: 'Never' }).count(), 1, 'Never stays a real choice');
    } finally { await page.close(); }
  });
});
