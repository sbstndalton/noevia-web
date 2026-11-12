'use strict';
// sbstndalton/noevia#2474: a member who finished the Diary step, signed out and signed in again landed on step 1 again.
// A resumed wizard now opens at the first step the account does not already show as done (Diary on = step 1 done).
// Mocked routes only; fails on a build of main, passes with the change. 375 and 768 px, light and dark.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

run('wizard-resume-2474', Number(process.env.QA_PORT || 32474), async (check, browser, origin) => {
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: step 1 done → sign out → sign in → wizard opens at step 2`, async () => {
      const page = await themedPage(browser, view);
      try {
        let signedIn = false, diaryEnabled = false;
        const user = () => ({ id: 'qa-2474', username: 'qa-member', displayName: 'QA member', role: 'member', disabled: false, diaryEnabled, onboarded: false });
        await page.route('**/api/**', (route) => {
          const req = route.request(), p = new URL(req.url()).pathname, json = (b, status = 200) => route.fulfill({ status, json: b });
          if (p === '/api/auth/session') return signedIn ? json({ user: user() }) : json({ error: 'Not signed in' }, 401);
          if (p === '/api/auth/login/password') { signedIn = true; return json({ user: user() }); }
          if (p === '/api/auth/logout') { signedIn = false; return json({ ok: true }); }
          if (p === '/api/profile') return json({ user: user(), passkeys: [] });
          if (p === '/api/profile/features') { diaryEnabled = req.postDataJSON().diaryEnabled; return json({ diaryEnabled }); }
          if (p === '/api/setup/status') return json({ configured: true });
          if (p === '/api/integrations/storage') return json({ kind: 'local', corpusRoot: '' });
          return route.continue();
        });
        const signIn = async () => {
          await page.locator('#username').fill('qa-member');
          await page.locator('#password').fill('qa synthetic password 2474');
          await page.getByRole('button', { name: 'Sign in with password' }).click();
        };
        await page.goto(origin);
        await signIn();
        await page.getByRole('heading', { name: 'Set up the diary' }).waitFor({ timeout: 15000 });
        await page.getByText('1 / 3', { exact: true }).waitFor();
        await page.getByRole('checkbox', { name: /Enable the Diary add-on/ }).click(); // controlled: it ticks once the save answers
        await page.getByRole('button', { name: 'Skip — set up later in Settings' }).waitFor();
        await page.getByRole('button', { name: 'Skip — set up later in Settings' }).click();
        await page.getByRole('heading', { name: 'Preferences' }).waitFor();
        await page.getByRole('button', { name: 'Sign out — resume later' }).click();
        await page.locator('#username').waitFor({ timeout: 15000 });
        await signIn();
        await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 });
        await page.getByText(/^\d \/ 3$/).waitFor();
        const label = await page.getByText(/^\d \/ 3$/).textContent();
        assert.equal(label, '2 / 3', `wizard opened at ${label} (${await page.getByRole('heading', { level: 1 }).first().textContent()})`);
        await page.getByRole('heading', { name: 'Preferences' }).waitFor({ timeout: 2000 });
        const dots = await page.locator('.wizard-dot').evaluateAll((els) => els.map((e) => e.className));
        assert.ok(/done/.test(dots[0]) && /active/.test(dots[1]), `progress dots: ${dots.join(' | ')}`);
        await shot(page, `wizard-resume-${view[0]}-${view[2]}`);
        await page.getByRole('button', { name: 'Back' }).click();
        await page.getByRole('heading', { name: 'Set up the diary' }).waitFor({ timeout: 2000 });
      } finally { await page.close(); }
    });
  }
});
