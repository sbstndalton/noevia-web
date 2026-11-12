'use strict';
// sbstndalton/noevia#2458: Settings search narrowed the section list but the detail pane stayed on the old section. Now, at desktop
// widths, one remaining section opens in the pane; when the open section is filtered out and several remain the first remaining one
// opens; a query that keeps the open section leaves it; clearing the search does not jump back. On a phone (list and detail are
// separate views) nothing moves. Offline (diary-fixture.cjs). Fails on a build of main, passes with the change.
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');
const { openSettings } = require('./nav.cjs');

async function settingsAt(browser, origin, view) {
  const page = await themedPage(browser, view);
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await openSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.locator('.settings-navigation nav button').first().waitFor();
  return { page, settings, search: settings.getByLabel('Search settings') };
}
const navNames = (settings) => settings.locator('.settings-navigation nav button').evaluateAll((els) => els.map((e) => e.textContent.trim()));
const paneTitle = (settings) => settings.locator('.settings-detail h2, .settings-detail h1, .settings-detail-scroll h2').first().textContent();

run('settings-search-follow-2458', Number(process.env.QA_PORT || 32458), async (check, browser, origin) => {
  await check('1280 px: one match (notif) opens that section in the pane; clearing keeps it', async () => {
    const { page, settings, search } = await settingsAt(browser, origin, [1280, 900, 'light']);
    try {
      await settings.getByRole('heading', { name: 'Appearance and language' }).first().waitFor();
      await search.fill('notif');
      assert.deepEqual(await navNames(settings), ['Notifications']);
      await settings.getByRole('heading', { name: 'Notifications' }).first().waitFor({ timeout: 5000 });
      await shot(page, 'settings-search-notif-1280-light');
      await settings.getByRole('button', { name: 'Clear settings search' }).click();
      await page.waitForTimeout(200);
      await settings.getByRole('heading', { name: 'Notifications' }).first().waitFor({ timeout: 5000 });
      assert.ok((await navNames(settings)).length > 3, 'the full list is back');
    } finally { await page.close(); }
  });
  await check('1280 px: several matches, open one filtered out -> first remaining opens; open one kept -> stays', async () => {
    const { page, settings, search } = await settingsAt(browser, origin, [1280, 900, 'dark']);
    try {
      let names = [], query = '';
      for (query of ['account', 'connect', 'security', 'diary', 'set', 'a']) { await search.fill(query); names = await navNames(settings); if (names.length > 1 && !names.includes('Appearance and language')) break; }
      assert.ok(names.length > 1, `several sections match: ${names}`);
      assert.ok(!names.includes('Appearance and language'));
      await settings.getByRole('heading', { name: names[0] }).first().waitFor({ timeout: 5000 });
      await shot(page, 'settings-search-several-1280-dark');
      // The pane is on names[0]; a longer query that still matches it keeps it, even though another is listed first.
      await search.fill('');
      await settings.getByRole('button', { name: names[names.length - 1], exact: true }).click();
      await search.fill(query);
      await settings.getByRole('heading', { name: names[names.length - 1] }).first().waitFor({ timeout: 5000 });
    } finally { await page.close(); }
  });
  await check('375 px: searching does not move the detail view', async () => {
    const { page, settings, search } = await settingsAt(browser, origin, [375, 812, 'light']);
    try {
      const view = () => settings.evaluate((el) => el.closest('.settings-stage')?.dataset.view ?? el.dataset.view);
      const before = await view();
      await search.fill('notif');
      assert.deepEqual(await navNames(settings), ['Notifications']);
      assert.equal(await view(), before, 'still the list view');
      await settings.getByRole('button', { name: 'Clear settings search' }).click();
      assert.equal(await settings.locator('.settings-navigation [aria-current="page"]').textContent().then((s) => s.trim()), 'Appearance and language');
    } finally { await page.close(); }
  });
});
