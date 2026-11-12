'use strict';
// sbstndalton/noevia#2457: the passkey "Secure your account" step came after every password sign-in, even after "Set up later".
// Now "Set up later" is remembered per browser for 30 days (localStorage, keyed by account id): sign in -> step shown -> Set up later ->
// sign out -> sign in -> straight to the app; with the stored time moved back 31 days the step is shown again; registering a passkey
// clears it; another account in the same browser still sees the step. Offline: every auth call is mocked. Fails on a build of main,
// passes with the change.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

const DAY = 24 * 60 * 60 * 1000;
const KEY = (id) => `noevia-passkey-later:${id}`;

async function mockAuth(page, userId = 'qa-member') {
  const state = { signedIn: false, logins: 0 };
  const user = { id: userId, username: 'qa-member', displayName: 'QA member', role: 'member', diaryEnabled: false, onboarded: true };
  await page.route('**/api/**', (route) => {
    const req = route.request(), p = new URL(req.url()).pathname, json = (b, status = 200) => route.fulfill({ status, json: b });
    if (p === '/api/setup/status') return json({ configured: true });
    if (p === '/api/auth/session') return state.signedIn ? json({ user, passkeys: [] }) : json({ error: 'signed out' }, 401);
    if (p === '/api/profile') return json({ user, passkeys: [] });
    if (p === '/api/auth/login/password') { state.signedIn = true; state.logins++; return json({ user }); }
    if (p === '/api/auth/logout') { state.signedIn = false; return json({ ok: true }); }
    if (p === '/api/auth/passkeys/register/options') return json({ error: 'qa: no authenticator' }, 400);
    return route.continue();
  });
  return state;
}
const signIn = async (page) => {
  await page.getByLabel('Username').fill('qa-member');
  await page.getByLabel('Password').fill('synthetic qa password');
  await page.getByRole('button', { name: /^Sign in/ }).click();
};
const step = (page) => page.getByRole('heading', { name: 'Secure your account' });
const inApp = (page) => page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ timeout: 10000 });
async function signOut(page) {
  // A first sign-in after Set up later opens Settings (cowork-new-account); close it first.
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  if (await settings.isVisible()) { await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden', timeout: 5000 }); }
  await page.getByRole('button', { name: /Account menu for/ }).filter({ visible: true }).first().click();
  await Promise.all([page.waitForNavigation(), page.getByRole('menuitem', { name: 'Log out' }).click()]);
}

run('passkey-later-2457', Number(process.env.QA_PORT || 32457), async (check, browser, origin) => {
  await check('Set up later holds across sign-out and sign-in; 31 days later the step returns', async () => {
    const page = await themedPage(browser, [1280, 800, 'light']);
    try {
      await mockAuth(page);
      await page.goto(origin);
      await signIn(page);
      await step(page).waitFor({ timeout: 10000 });
      await shot(page, 'passkey-step-1280-light');
      await page.getByRole('button', { name: 'Set up later' }).click();
      await inApp(page);
      assert.ok(await page.evaluate((k) => localStorage.getItem(k), KEY('qa-member')), 'the choice is stored for this account');
      await signOut(page);
      await signIn(page);
      await inApp(page);
      assert.equal(await step(page).count(), 0, 'no step within 30 days');
      // Moved back 31 days: the step is due again.
      await page.evaluate(([k, ms]) => localStorage.setItem(k, String(Date.now() - ms)), [KEY('qa-member'), 31 * DAY]);
      await signOut(page);
      await signIn(page);
      await step(page).waitFor({ timeout: 10000 });
      // And 29 days is still inside the window.
      await page.getByRole('button', { name: 'Set up later' }).click();
      await inApp(page);
      await page.evaluate(([k, ms]) => localStorage.setItem(k, String(Date.now() - ms)), [KEY('qa-member'), 29 * DAY]);
      await signOut(page);
      await signIn(page);
      await inApp(page);
      assert.equal(await step(page).count(), 0, '29 days: still remembered');
    } finally { await page.close(); }
  });
  await check('another account in the same browser still sees the step', async () => {
    const page = await themedPage(browser, [1280, 800, 'light']);
    try {
      await mockAuth(page, 'qa-other');
      await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [KEY('qa-member'), String(Date.now())]);
      await page.goto(origin);
      await signIn(page);
      await step(page).waitFor({ timeout: 10000 });
    } finally { await page.close(); }
  });
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: the step itself still reads and fits`, async () => {
      const page = await themedPage(browser, view);
      try {
        await mockAuth(page);
        await page.goto(origin);
        await signIn(page);
        await step(page).waitFor({ timeout: 10000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await shot(page, `passkey-step-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
});
