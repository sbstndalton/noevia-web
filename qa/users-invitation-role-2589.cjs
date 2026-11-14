'use strict';
// sbstndalton/noevia#2589 (the noevia-web#131 items): the notice after "Copy invitation link" and the one after "Copy link again" both name
// the role the link was made for, in a sentence that reads naturally (a member, an administrator: no capitalised role noun, German no
// "für Admin"). Before, "Copy link again" fell back to the generic "Invitation link copied". 375 and 1280 px, light and dark. Offline (diary-fixture.cjs, mocked admin APIs). Fails on a build of main.
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];
const SENTENCE = {
  en: { member: 'Single-use invitation for a member (expires in 24 hours) copied.', admin: 'Single-use invitation for an administrator (expires in 24 hours) copied.' },
};

run('users-invitation-role-2589', Number(process.env.QA_PORT || 32589), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const [width, , theme] = view;
    await check(`${width} px ${theme}: the copied notice names the role, also after "Copy link again"`, async () => {
      const page = await themedPage(browser, view);
      try {
        await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } }); });
        const roles = [];
        await page.route('**/api/**', (route) => {
          const req = route.request(), p = new URL(req.url()).pathname, json = (b, status = 200) => route.fulfill({ status, json: b });
          const admin = { id: 'qa', username: 'admin', displayName: 'Synthetic admin', role: 'admin', diaryEnabled: false, onboarded: true };
          if (p === '/api/profile' || p === '/api/auth/session') return json({ user: admin, passkeys: [] });
          if (p === '/api/admin/users') return json({ users: [admin] });
          if (p === '/api/admin/invitations' && req.method() === 'POST') { roles.push(req.postDataJSON().role); return json({ token: `qa-invite-${roles.length}`, expiresAt: Date.now() + 864e5 }); }
          return route.continue();
        });
        await page.goto(`${origin}/settings/users`);
        const users = page.locator('.settings-users');
        await users.waitFor({ timeout: 15000 });
        const notice = (text) => users.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 5000 });
        await users.getByRole('button', { name: 'Copy invitation link' }).click();
        await notice(SENTENCE.en.member);
        await users.getByRole('button', { name: 'Copy link again' }).click();
        await notice(SENTENCE.en.member);
        await users.getByLabel('Invitation role').selectOption('admin');
        await users.getByRole('button', { name: 'Copy invitation link' }).click();
        await notice(SENTENCE.en.admin);
        await users.getByRole('button', { name: 'Copy link again' }).click();
        await notice(SENTENCE.en.admin);
        assert.deepEqual(roles, ['member', 'admin']);
        await shot(page, `users-invitation-role-2589-${width}-${theme}`);
      } finally { await page.close(); }
    });
  }
});
