'use strict';
// sbstndalton/noevia#2456: /diary showed an empty main panel for an account whose Diary is off or unreachable. The view now always renders a
// state: Diary off -> "Diary is off for this account" with a button to Settings -> Diary and storage; Diary on but its routes failing ->
// "Diary can't be reached right now" with Try again, never a raw "Internal error"; Try again recovers into the normal Diary once the routes
// answer. 375/768/1280 px, light and dark. Offline: profile and /api/diary/* are mocked over diary-fixture.cjs. Fails on a build of main,
// passes with the change.
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [768, 900, 'light'], [768, 900, 'dark'], [1280, 800, 'light'], [1280, 800, 'dark']];
const user = (diaryEnabled) => ({ id: 'qa-member', username: 'qa-member', displayName: 'QA member', role: 'member', diaryEnabled, onboarded: true });

async function open(browser, origin, view, { diaryEnabled, diaryUp = () => true }) {
  const page = await themedPage(browser, view);
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user: user(diaryEnabled), passkeys: [] } }));
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user: user(diaryEnabled), passkeys: [] } }));
  await page.route('**/api/diary/**', (r) => diaryUp() ? r.fallback() : r.fulfill({ status: 500, json: { error: 'Internal error' } }));
  await page.route('**/api/integrations/storage', (r) => diaryUp() ? r.fallback() : r.fulfill({ status: 500, json: { error: 'Internal error' } }));
  await page.goto(`${origin}/diary`);
  return page;
}
const mainText = (page) => page.evaluate(() => [...document.querySelectorAll('main')].map((m) => m.innerText).join('\n'));

run('diary-states-2456', Number(process.env.QA_PORT || 32456), async (check, browser, origin) => {
  await check('profile unreadable: not claimed to be off; Try again recovers into the Diary, focus stays on the button', async () => {
    let up = false;
    const page = await themedPage(browser, [1280, 800, 'light']);
    try {
      await page.route('**/api/profile', (r) => up ? r.fulfill({ json: { user: user(true), passkeys: [] } }) : r.fulfill({ status: 500, json: { error: 'Internal error' } }));
      await page.goto(`${origin}/diary`);
      await page.getByRole('heading', { name: "Diary can't be reached right now" }).waitFor({ timeout: 15000 });
      assert.equal(await page.getByText('Diary is off for this account').count(), 0);
      up = true;
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.locator('.diary-calendar, .diary-composer-dock').first().waitFor({ timeout: 15000 });
    } finally { await page.close(); }
  });
  await check('Try again while still down keeps the notice and the focused button', async () => {
    const page = await open(browser, origin, [1280, 800, 'light'], { diaryEnabled: true, diaryUp: () => false });
    try {
      await page.getByRole('heading', { name: "Diary can't be reached right now" }).waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByRole('heading', { name: "Diary can't be reached right now" }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Try again');
    } finally { await page.close(); }
  });
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: Diary off for the account shows a message and a way to Settings`, async () => {
      const page = await open(browser, origin, view, { diaryEnabled: false });
      try {
        await page.getByRole('heading', { name: 'Diary is off for this account' }).waitFor({ timeout: 10000 });
        assert.doesNotMatch(await mainText(page), /Internal error/);
        await shot(page, `diary-off-${view[0]}-${view[2]}`);
        await page.getByRole('button', { name: 'Open Diary and storage' }).click();
        await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('heading', { name: 'Diary and storage' }).first().waitFor({ timeout: 10000 });
      } finally { await page.close(); }
    });
    await check(`${tag}: Diary on but unreachable says so with Try again, then recovers`, async () => {
      let up = false;
      const page = await open(browser, origin, view, { diaryEnabled: true, diaryUp: () => up });
      try {
        await page.getByRole('heading', { name: "Diary can't be reached right now" }).waitFor({ timeout: 15000 });
        assert.doesNotMatch(await mainText(page), /Internal error/, 'no raw server error');
        await shot(page, `diary-unreachable-${view[0]}-${view[2]}`);
        // Still down: Try again keeps the state, it does not go blank.
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.getByRole('heading', { name: "Diary can't be reached right now" }).waitFor({ timeout: 15000 });
        up = true;
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.getByRole('heading', { name: "Diary can't be reached right now" }).waitFor({ state: 'hidden', timeout: 15000 });
        await page.locator('.diary-calendar, .diary-composer-dock').first().waitFor({ timeout: 15000 });
        assert.doesNotMatch(await mainText(page), /Internal error/, 'the old failure is not left behind');
        await shot(page, `diary-recovered-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
});
