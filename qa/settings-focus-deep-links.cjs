// #401/#403, against synthetic APIs only: closing Settings (Escape or the Close button) returns
// focus to whatever opened it — the composer after ⌘,/Ctrl+,, the account menu's own trigger
// after Account menu -> Settings, and the chat header's own Settings control — and every section
// SettingsShell lists opens at its own /settings/<id> address.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = 31461;

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (route) => {
      const p = new URL(route.request().url()).pathname;
      const json = (body) => route.fulfill({ json: body });
      // Admin, so the Web address and Service status sections (#403) are reachable at all.
      if (p === '/api/profile' || p === '/api/auth/session') {
        return json({ user: { id: 'qa', username: 'focusqa', displayName: 'Focus QA', role: 'admin', diaryEnabled: true, onboarded: true }, passkeys: [] });
      }
      if (p === '/api/models/installed') return json([]);
      if (p === '/api/health') return json({ inferenceUp: true, diaryUp: true });
      if (p === '/api/admin/web-address') return json({ origin: 'https://qa.example', source: 'settings', previous: [], rpId: 'qa.example' });
      return route.continue();
    });

    await page.goto(`http://localhost:${PORT}`);
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.waitFor();
    const settings = () => page.getByRole('region', { name: 'Settings' });
    const mod = await page.evaluate(() => (/mac|iphone|ipad/i.test(navigator.platform) ? 'Meta' : 'Control'));

    // ── #401: three ways in, two ways to close, each hands focus back to its own opener ──
    async function openAndClose(open, opener, label) {
      for (const closeWith of ['Escape', 'Close button']) {
        await open();
        await settings().waitFor();
        if (closeWith === 'Escape') await page.keyboard.press('Escape');
        else await settings().getByRole('button', { name: 'Close settings', exact: true }).click();
        // The focus-restore effect runs on Settings' real unmount, ~240ms after Escape/Close (the
        // exit animation plays first) — waiting on the region's own accessibility-tree state
        // (Playwright's 'hidden'/'detached') reports gone well before that unmount actually runs,
        // so this polls the one thing that actually matters: where focus really ends up.
        const openerHandle = await opener.elementHandle();
        await page.waitForFunction((el) => el === document.activeElement, openerHandle).catch(() => {});
        const onOpener = await opener.evaluate((el) => el === document.activeElement);
        assert.ok(onOpener, `${label} (${closeWith}) left focus on ${await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120))} instead of its opener`);
      }
    }

    // 1) The ⌘,/Ctrl+, shortcut, fired from the composer.
    await composer.click();
    await openAndClose(async () => page.keyboard.press(`${mod}+Comma`), composer, '⌘, from the composer');

    // 2) Account menu -> Settings. The clicked menu item is unmounted (the popover closes) in the
    //    same update that opens Settings — the regression #401 was actually about — so the real
    //    assertion is that focus lands on the trigger, which is still on screen, not on <body>.
    const accountTrigger = page.getByRole('button', { name: 'Account menu for Focus QA', exact: true });
    await openAndClose(async () => {
      await accountTrigger.click();
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    }, accountTrigger, 'Account menu -> Settings');

    // 3) The chat header's own Settings control (the sliders icon next to the chat title).
    const headerSettings = page.getByTitle('Settings', { exact: true });
    await openAndClose(async () => headerSettings.click(), headerSettings, 'the chat header Settings control');

    assert.deepEqual(errors, [], `uncaught page errors: ${errors.join('; ')}`);

    // ── #403: every section SettingsShell lists opens at its own /settings/<id> address ──
    await page.goto(`http://localhost:${PORT}/settings/account`);
    await settings().getByRole('heading', { name: 'Account', level: 1 }).waitFor();

    await page.goto(`http://localhost:${PORT}/settings/address`);
    await settings().getByRole('heading', { name: 'Web address', level: 1 }).waitFor();

    // Service status has no <h1> of its own (its title lives in the detail pane's header, not the
    // content), so "Connected services" — the real <h2> only this section renders — is the marker.
    await page.goto(`http://localhost:${PORT}/settings/status`);
    await settings().getByRole('heading', { name: 'Connected services', level: 2 }).waitFor();

    console.log('PASS settings focus + deep links: closing Settings (Escape and Close) from the composer shortcut, the account menu and the chat header all return focus to their own opener; /settings/account, /settings/address and /settings/status each open their own section.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
