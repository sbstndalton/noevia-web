'use strict';
// sbstndalton/noevia#2581: (1) "Set up later" on the sign-in "Secure your account" card opened Settings > Appearance as if the
// account were new; the card now just closes and the app stays where the address was. (2) "Set up later" on the setup wizard's
// passkey step was not the choice #2457 remembers: the next password sign-in showed "Secure your account" again. 375 and 1280 px,
// light and dark. Offline (diary-fixture.cjs, mocked auth). Fails on a build of main for both parts.
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];

function mockAuth(page, { onboarded }) {
  const state = { signedIn: false, onboarded };
  const user = () => ({ id: 'qa-2581', username: 'qa-member', displayName: 'QA member', role: 'member', disabled: false, diaryEnabled: false, onboarded: state.onboarded });
  return page.route('**/api/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname, json = (b, status = 200) => route.fulfill({ status, json: b });
    if (p === '/api/auth/session') return state.signedIn ? json({ user: user() }) : json({ error: 'Not signed in' }, 401);
    if (p === '/api/auth/login/password') { state.signedIn = true; return json({ user: user() }); }
    if (p === '/api/auth/logout') { state.signedIn = false; return json({ ok: true }); }
    if (p === '/api/profile') return json({ user: user(), passkeys: [] });
    if (p === '/api/profile/onboarding') { state.onboarded = true; return json({ onboarded: true }); }
    if (p === '/api/setup/status') return json({ configured: true });
    if (p === '/api/integrations/storage') return json({ kind: 'local', corpusRoot: '' });
    if (p === '/api/models/routing-default' || p === '/api/routing-default') return json({ routing: 'auto' });
    return route.continue();
  }).then(() => state);
}
const signIn = async (page) => {
  await page.locator('#username').fill('qa-member');
  await page.locator('#password').fill('qa synthetic password 2581');
  await page.getByRole('button', { name: 'Sign in with password' }).click();
};

run('passkey-later-2581', Number(process.env.QA_PORT || 32581), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const [width, , theme] = view;
    await check(`${width} px ${theme}: "Set up later" on the sign-in card closes it and stays on the page (no Settings)`, async () => {
      const page = await themedPage(browser, view);
      try {
        await mockAuth(page, { onboarded: true });
        await page.goto(origin);
        await signIn(page);
        await page.getByRole('heading', { name: 'Secure your account' }).waitFor({ timeout: 15000 });
        await shot(page, `passkey-later-2581-card-${width}-${theme}`);
        await page.getByRole('button', { name: 'Set up later', exact: true }).click();
        await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
        await page.waitForTimeout(600);
        assert.equal(await page.getByRole('dialog', { name: 'Settings', exact: true }).count(), 0, 'Settings did not open');
        assert.ok(!new URL(page.url()).pathname.startsWith('/settings'), `the address stays on the page (${new URL(page.url()).pathname})`);
        await shot(page, `passkey-later-2581-after-${width}-${theme}`);
      } finally { await page.close(); }
    });
    await check(`${width} px ${theme}: "Set up later" in the wizard is remembered, so the next sign-in goes straight to the app`, async () => {
      const page = await themedPage(browser, view);
      try {
        const state = await mockAuth(page, { onboarded: false });
        await page.goto(origin);
        await signIn(page);
        await page.getByRole('heading', { name: 'Set up the diary' }).waitFor({ timeout: 15000 });
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByRole('heading', { name: 'Preferences' }).waitFor();
        await page.getByRole('button', { name: 'Skip — set up later' }).click();
        await page.getByRole('heading', { name: 'Secure your account' }).waitFor();
        await page.getByText('3 / 3', { exact: true }).waitFor();
        await shot(page, `passkey-later-2581-wizard-${width}-${theme}`);
        await page.getByRole('button', { name: 'Set up later', exact: true }).click();
        await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
        assert.equal(state.onboarded, true, 'the wizard finished the account');
        // Sign out and in again: the choice holds, so no "Secure your account" card.
        await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
        await page.goto(origin);
        await page.locator('#username').waitFor({ timeout: 15000 });
        await signIn(page);
        await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 15000 });
        await page.waitForTimeout(600);
        assert.equal(await page.getByRole('heading', { name: 'Secure your account' }).count(), 0, 'the passkey step does not come back');
        await shot(page, `passkey-later-2581-signin-${width}-${theme}`);
      } finally { await page.close(); }
    });
  }
});
