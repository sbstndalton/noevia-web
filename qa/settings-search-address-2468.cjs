'use strict';
// sbstndalton/noevia#2468 (the address part): when a Settings search moves the detail pane to another section (#2458, noevia-web#125)
// the address bar follows it the way a click on that section does, and Back returns to the section the person was on. 1280 px,
// light and dark. Offline (diary-fixture.cjs). Fails on a build of main when the address stays on the old section.
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');
const { openSettings } = require('./nav.cjs');

const path = (page) => new URL(page.url()).pathname;

async function settingsAt(browser, origin, view) {
  const page = await themedPage(browser, view);
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await openSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.locator('.settings-navigation nav button').first().waitFor();
  return { page, settings, search: settings.getByLabel('Search settings') };
}

run('settings-search-address-2468', Number(process.env.QA_PORT || 32468), async (check, browser, origin) => {
  for (const theme of ['light', 'dark']) {
    await check(`1280 px ${theme}: a query that leaves one section moves the address to it; Back returns to the section before`, async () => {
      const { page, settings, search } = await settingsAt(browser, origin, [1280, 900, theme]);
      try {
        await settings.getByRole('heading', { name: 'Appearance and language' }).first().waitFor();
        await page.waitForFunction(() => location.pathname === '/settings/appearance', null, { timeout: 5000 });
        await search.fill('notif');
        await settings.getByRole('heading', { name: 'Notifications' }).first().waitFor({ timeout: 5000 });
        assert.equal(path(page), '/settings/notifications', 'the address follows the pane');
        await shot(page, `settings-search-address-${theme}`);
        // The same as a click: one history step, so Back returns to the section the person was on.
        await page.goBack();
        await settings.getByRole('heading', { name: 'Appearance and language' }).first().waitFor({ timeout: 5000 });
        assert.equal(path(page), '/settings/appearance');
      } finally { await page.close(); }
    });
  }
  await check('1280 px: the address after a click on a section is the same shape as after a search', async () => {
    const { page, settings } = await settingsAt(browser, origin, [1280, 900, 'light']);
    try {
      await settings.getByRole('button', { name: 'Notifications', exact: true }).click();
      await settings.getByRole('heading', { name: 'Notifications' }).first().waitFor({ timeout: 5000 });
      assert.equal(path(page), '/settings/notifications');
      await page.goBack();
      assert.equal(path(page), '/settings/appearance');
    } finally { await page.close(); }
  });
});
