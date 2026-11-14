'use strict';
// sbstndalton/noevia#2505: typing a Settings search key by key moves the pane through the sections the partial query matches; each
// move added a history step, so Back landed on sections the person never chose. One search is now one step: Back returns to the
// section the person was on. 1280 px (the pane follows the query) and 375 px (the list and the detail are separate views, so nothing
// moves), light and dark. Offline (diary-fixture.cjs). Fails on a build of main (two or more steps, Back lands on a passed section).
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');
const { openSettings } = require('./nav.cjs');

const VIEWS = [[1280, 900, 'light'], [1280, 900, 'dark'], [375, 812, 'light'], [375, 812, 'dark']];
const path = (page) => new URL(page.url()).pathname;

async function settingsAt(browser, origin, view) {
  const page = await themedPage(browser, view);
  await page.goto(origin);
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await openSettings(page);
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button').first().waitFor();
  return { page, settings, search: settings.getByLabel('Search settings') };
}

run('settings-search-history-2505', Number(process.env.QA_PORT || 32505), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const [width, , theme] = view;
    const wide = width > 700;
    await check(`${width} px ${theme}: typing a query is one history step; Back returns to the section the person was on`, async () => {
      const { page, settings, search } = await settingsAt(browser, origin, view);
      try {
        if (wide) await page.waitForFunction(() => location.pathname === '/settings/appearance', null, { timeout: 5000 });
        const before = { length: await page.evaluate(() => history.length), at: path(page) };
        await search.pressSequentially('privacy', { delay: 250 });
        await page.waitForTimeout(400);
        const steps = (await page.evaluate(() => history.length)) - before.length;
        const passed = path(page);
        await shot(page, `settings-search-history-2505-${width}-${theme}`);
        if (wide) {
          assert.notEqual(passed, before.at, 'the pane followed the query to another section');
          assert.equal(steps, 1, `the whole search adds one history step, not one per section it passes (got ${steps}, ended at ${passed})`);
          await page.goBack();
          await page.waitForFunction((p) => location.pathname === p, before.at, { timeout: 5000 });
          assert.equal(path(page), before.at, 'one Back returns to the section the person was on');
        } else {
          assert.equal(steps, 0, `nothing moves on a phone while typing (got ${steps} steps)`);
        }
      } finally { await page.close(); }
    });
  }
  await check('1280 px: a search that only matches the open section adds no step; a later move still returns to it', async () => {
    const { page, settings, search } = await settingsAt(browser, origin, [1280, 900, 'light']);
    try {
      await page.waitForFunction(() => location.pathname === '/settings/appearance', null, { timeout: 5000 });
      const length = await page.evaluate(() => history.length);
      await search.fill('theme');
      await page.waitForTimeout(300);
      assert.equal(path(page), '/settings/appearance');
      assert.equal(await page.evaluate(() => history.length), length, 'no step while the query stays on the open section');
      await search.fill('notif');
      await settings.getByRole('heading', { name: 'Notifications' }).first().waitFor({ timeout: 5000 });
      assert.equal(await page.evaluate(() => history.length), length + 1);
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/settings/appearance', null, { timeout: 5000 });
    } finally { await page.close(); }
  });
  await check('1280 px: clicking a section after a search is a new step', async () => {
    const { page, settings, search } = await settingsAt(browser, origin, [1280, 900, 'light']);
    try {
      await page.waitForFunction(() => location.pathname === '/settings/appearance', null, { timeout: 5000 });
      await search.fill('notif');
      await settings.getByRole('heading', { name: 'Notifications' }).first().waitFor({ timeout: 5000 });
      const length = await page.evaluate(() => history.length);
      await search.fill('');
      await settings.getByRole('button', { name: 'Appearance and language', exact: true }).click();
      await page.waitForFunction(() => location.pathname === '/settings/appearance', null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => history.length), length + 1, 'a click adds its own step');
    } finally { await page.close(); }
  });
});
