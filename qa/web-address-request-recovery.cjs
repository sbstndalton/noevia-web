// Synthetic Web address transport failures. The fixture is loopback only; no live settings change.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const original = { origin: 'https://old.example.test', source: 'settings', previous: [], rpId: 'old.example.test' };
const updated = { ...original, origin: 'https://new.example.test', previous: [original.origin], rpId: 'new.example.test' };
const admin = { id: 'synthetic-admin', username: 'fixture', displayName: 'Synthetic admin', role: 'admin', disabled: false, diaryEnabled: true, onboarded: true };

(async () => {
  const fixture = createFixture(31457);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  try {
    for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const tag = `${width}/${theme}`;
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.addInitScript(selected => localStorage.setItem('cowork-theme', selected), theme);
      await page.route('**/api/auth/session', route => route.fulfill({ json: { user: admin } }));
      await page.route('**/api/profile', route => route.fulfill({ json: { user: admin, passkeys: [] } }));
      let getSucceeds = false;
      let postAttempt = 0;
      const posted = [];
      await page.route('**/api/admin/web-address', async route => {
        if (route.request().method() === 'GET') {
          if (!getSucceeds) return route.abort('failed');
          return route.fulfill({ json: original });
        }
        const body = route.request().postDataJSON();
        posted.push(body);
        postAttempt++;
        if (postAttempt === 1) return route.abort('failed');
        if (postAttempt === 2) return route.fulfill({ status: 422, json: { error: 'Address is unreachable.', unreachable: true } });
        if (postAttempt === 3) return route.fulfill({ status: 200, contentType: 'application/json', body: '{broken' });
        return route.fulfill({ json: updated });
      });

      await page.goto('http://localhost:31457');
      await page.getByTitle('Settings', { exact: true }).click();
      const settings = page.getByRole('region', { name: 'Settings', exact: true });
      await settings.getByRole('button', { name: 'Web address', exact: true }).click();
      await settings.getByRole('alert').filter({ hasText: 'could not be loaded' }).waitFor();
      assert.equal(await settings.getByText('Loading…').count(), 0, `${tag}: loading released`);
      getSucceeds = true;
      await settings.getByRole('button', { name: 'Retry' }).click();
      await settings.getByText(original.origin, { exact: true }).waitFor();
      assert.equal(await settings.getByRole('alert').count(), 0, `${tag}: load error cleared`);

      const input = settings.getByRole('textbox', { name: 'New address' });
      const save = settings.getByRole('button', { name: 'Check and save' });
      await input.fill('new.example.test/');
      await save.click();
      await settings.getByRole('alert').filter({ hasText: 'Could not save' }).waitFor();
      assert.equal(await input.inputValue(), 'new.example.test/', `${tag}: entered value retained`);
      assert.equal(await save.isEnabled(), true, `${tag}: transport failure releases save`);
      await save.click();
      await settings.getByRole('alert').filter({ hasText: 'Address is unreachable.' }).waitFor();
      await settings.getByRole('button', { name: 'Save anyway' }).click();
      await settings.getByRole('alert').filter({ hasText: 'Could not save' }).waitFor();
      assert.equal(await save.isEnabled(), true, `${tag}: malformed success releases save`);
      await save.click();
      await settings.getByRole('status').filter({ hasText: updated.origin }).waitFor();
      assert.equal(await input.inputValue(), updated.origin, `${tag}: saved address shown`);
      assert.equal(await settings.getByRole('alert').count(), 0, `${tag}: save error cleared`);
      assert.deepEqual(posted.map(entry => [entry.origin, entry.force]), [
        ['https://new.example.test', false], ['https://new.example.test', false],
        ['https://new.example.test', true], ['https://new.example.test', false],
      ], `${tag}: normalized address and explicit force preserved`);
      assert.deepEqual(pageErrors, [], `${tag}: no uncaught page errors`);
      assert.ok(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${tag}: no horizontal overflow`);
      await page.close();
    }

    // A slow response from a section that has been left must not overwrite a later mount.
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.route('**/api/auth/session', route => route.fulfill({ json: { user: admin } }));
    await page.route('**/api/profile', route => route.fulfill({ json: { user: admin, passkeys: [] } }));
    const releaseOld = [];
    let holdOld = true;
    let oldRequested;
    const requested = new Promise(resolve => { oldRequested = resolve; });
    await page.route('**/api/admin/web-address', async route => {
      if (holdOld) { oldRequested(); await new Promise(resolve => { releaseOld.push(resolve); }); return route.fulfill({ json: { ...original, origin: 'https://stale.example.test' } }).catch(() => {}); }
      return route.fulfill({ json: original });
    });
    await page.goto('http://localhost:31457');
    await page.getByTitle('Settings', { exact: true }).click();
    const settings = page.getByRole('region', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'Web address', exact: true }).click();
    await requested;
    await settings.getByRole('button', { name: 'General', exact: true }).click();
    holdOld = false;
    await settings.getByRole('button', { name: 'Web address', exact: true }).click();
    await settings.getByText(original.origin, { exact: true }).waitFor();
    releaseOld.forEach(release => release());
    await page.waitForTimeout(100);
    assert.equal(await settings.getByText('https://stale.example.test').count(), 0, 'obsolete load is ignored');
    await page.close();
    console.log('PASS Web address recovery: rejected GET/POST, retry, HTTP/unreachable/force, malformed response, stale load; 375/1440 light/dark.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
