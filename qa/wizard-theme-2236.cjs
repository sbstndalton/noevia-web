'use strict';
// #2236: the first-run wizard rendered dark on a device set to light when the browser had no earlier theme: its own state started
// from `localStorage['cowork-theme'] === 'light' ? 'light' : 'dark'` and offered only Light and Dark. It now follows the device
// (System, the default everywhere else), offers "Match this device", and still honours a light or dark kept in the browser.
// Both ways in are checked: first-run setup (no account yet) and an account that has not finished onboarding (invitation / resume).
// Synthetic APIs only (setup status, session of a not-yet-onboarded administrator), real shapes.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/wizard-theme-2236.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, ADMIN, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const unfinished = { ...ADMIN, onboarded: false };
const status = (configured) => (page) => Promise.all([
  page.route('**/api/setup/status', (r) => r.fulfill({ json: { configured } })),
  page.route('**/api/admin/offsite-backup', (r) => r.fulfill({ json: { enabled: false } })),
]);
// The page's own look, not just the attribute: the background the wizard is painted on.
const luminance = (page) => page.evaluate(() => {
  const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
});
const theme = (page) => page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.themePreference]);

run('wizard-theme-2236', Number(process.env.QA_PORT || 32236), async (check, browser, origin) => {
  for (const view of [{ name: '1440', options: DESKTOP }, { name: 'iphone', options: IPHONE }]) {
    for (const device of ['light', 'dark']) {
      await check(`${view.name}, device ${device}, first-run setup: the wizard follows the device`, async () => {
        const { page, context, errors } = await openPage(browser, view, device, { storedTheme: false, mock: status(false) });
        await page.goto(origin);
        await page.getByRole('button', { name: 'Get started', exact: true }).waitFor();
        assert.equal((await theme(page))[0], device, 'data-theme');
        assert.equal((await luminance(page)) > 0.5, device === 'light', `the page is painted ${device === 'light' ? 'dark' : 'light'}`);
        await shot(page, `2236-first-run-${view.name}-device-${device}`);
        assert.deepEqual(errors, []);
        await context.close();
      });
      await check(`${view.name}, device ${device}, unfinished account: follows the device, "Match this device" is selected, Light and Dark still pin it`, async () => {
        const { page, context, errors } = await openPage(browser, view, device, { storedTheme: false, user: unfinished, mock: status(true) });
        await page.goto(origin);
        await page.getByRole('button', { name: 'Skip — set up later in Settings' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('heading', { name: 'Preferences' }).waitFor();
        assert.deepEqual(await theme(page), [device, 'system']);
        assert.equal(await page.getByRole('radio', { name: 'Match this device' }).isChecked(), true);
        await shot(page, `2236-prefs-${view.name}-device-${device}`, { fullPage: true });
        // The device changes while the wizard is open: System follows it live.
        const other = device === 'light' ? 'dark' : 'light';
        await page.emulateMedia({ colorScheme: other });
        await page.waitForFunction((t) => document.documentElement.dataset.theme === t, other);
        await page.emulateMedia({ colorScheme: device });
        await page.waitForFunction((t) => document.documentElement.dataset.theme === t, device);
        // An explicit choice pins the mode against the device.
        await page.getByRole('radio', { name: other === 'light' ? 'Light theme' : 'Dark theme' }).check();
        assert.deepEqual(await theme(page), [other, other]);
        await page.getByRole('radio', { name: 'Match this device' }).check();
        assert.deepEqual(await theme(page), [device, 'system']);
        assert.deepEqual(errors, []);
        await context.close();
      });
    }
  }
  await check('a theme kept in this browser (dark) is honoured on a light device', async () => {
    const { page, context } = await openPage(browser, { options: DESKTOP }, 'light', { storedTheme: false, user: unfinished, mock: status(true) });
    await page.addInitScript(() => localStorage.setItem('cowork-theme', 'dark'));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Skip — set up later in Settings' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Preferences' }).waitFor();
    assert.deepEqual(await theme(page), ['dark', 'dark']);
    assert.equal(await page.getByRole('radio', { name: 'Dark theme' }).isChecked(), true);
    await context.close();
  });
});
