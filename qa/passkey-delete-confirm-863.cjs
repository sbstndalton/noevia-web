// #863: removing a passkey asks first, and a server refusal (409, the account's last sign-in method)
// is shown with the server's own reason instead of a generic "unconfirmed" line. Synthetic
// account and routes only; nothing touches a real account.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { openSettings } = require('./nav.cjs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

(async () => {
  const fixture = createFixture(0); await fixture.listen();
  const origin = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME_PATH || undefined, channel: process.env.QA_CHROME_PATH ? undefined : 'chrome' });
  const errors = [];
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    page.on('pageerror', (e) => errors.push(e.message));
    const user = { id: 'u1', username: 'member', displayName: 'Synthetic member', role: 'member', disabled: false, diaryEnabled: false, onboarded: true };
    let passkeys = [{ id: 'pk1', name: 'Laptop key', deviceType: 'singleDevice', backedUp: false, createdAt: 1 }];
    const deletes = []; let refuse = true;
    await page.route('**/api/**', (route) => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (p === '/api/auth/session') return route.fulfill({ json: { user } });
      if (p === '/api/profile') return route.fulfill({ json: { user, passkeys, sessions: [] } });
      if (p === '/api/auth/passkeys/pk1' && req.method() === 'DELETE') {
        deletes.push(p);
        if (refuse) return route.fulfill({ status: 409, json: { error: 'This is your only way to sign in. Add a password or another passkey before removing it.' } });
        passkeys = []; return route.fulfill({ json: { ok: true } });
      }
      return route.continue();
    });
    await page.goto(origin); await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'Security and login', exact: true }).click();
    const x = settings.getByRole('button', { name: 'Remove passkey Laptop key', exact: true });
    await x.click();

    const dialog = page.getByRole('dialog', { name: 'Remove passkey Laptop key?' });
    await dialog.waitFor({ timeout: 3000 });
    assert.equal(deletes.length, 0, 'nothing is deleted before the user confirms');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 3000 });
    assert.equal(deletes.length, 0, 'cancel deletes nothing');
    console.log('PASS cancel keeps the passkey and sends no request');

    await x.click();
    await page.getByRole('dialog', { name: 'Remove passkey Laptop key?' }).getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await settings.locator('[role="alert"]').filter({ hasText: 'only way to sign in' }).waitFor({ timeout: 3000 });
    assert.equal(deletes.length, 1);
    assert.equal(await settings.locator('[role="alert"]').filter({ hasText: 'unconfirmed' }).count(), 0, 'the server reason replaces the generic message');
    console.log('PASS a 409 shows the server reason');

    refuse = false;
    await x.click();
    await page.getByRole('dialog', { name: 'Remove passkey Laptop key?' }).getByRole('button', { name: 'Remove passkey', exact: true }).click();
    await settings.getByText('Passkey removed.').waitFor({ timeout: 3000 });
    assert.equal(deletes.length, 2);
    assert.equal(await settings.getByRole('button', { name: 'Remove passkey Laptop key', exact: true }).count(), 0);
    console.log('PASS confirming removes the passkey');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await fixture.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
