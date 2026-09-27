// #463 — synthetic admin profile arrives after Settings mounts. The selected admin page
// must receive initial desktop focus without taking focus a person moved during loading.
// QA_DIST=/tmp/noevia-ui-dist QA_SCREENSHOTS=/tmp/noevia-ui-shots \
//   node qa/settings-admin-deeplink-focus.cjs
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const port = Number(process.env.QA_PORT || 31551);
const shots = process.env.QA_SCREENSHOTS || '/tmp/noevia-settings-admin-focus';
const admin = { id: 'synthetic-admin', username: 'synthetic-admin', displayName: 'Synthetic Admin', role: 'admin', diaryEnabled: true, onboarded: true };
const member = { ...admin, id: 'synthetic-member', username: 'synthetic-member', role: 'member' };

async function casePage(browser, { width, theme, section = 'users', role = 'admin', moved = false, cycled = false, profileError = false }) {
  const context = await browser.newContext(withLocale({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(theme => { localStorage.setItem('cowork-theme', theme); }, theme);
  const user = role === 'admin' ? admin : member;
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile', async route => {
    await new Promise(resolve => setTimeout(resolve, cycled ? 1300 : 650));
    if (profileError) await route.fulfill({ status: 503, json: { error: 'Synthetic profile unavailable' } });
    else await route.fulfill({ json: { user, passkeys: [] } });
  });
  try {
    await page.goto(`http://localhost:${port}/settings/${section}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.settings-navigation nav button').first().waitFor({ state: 'attached' });
    if (cycled) {
      const temporary = page.locator('.settings-navigation nav button').first();
      await page.waitForFunction(() => document.activeElement === document.querySelector('.settings-navigation nav button'));
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Keyboard & input', 'Tab must leave the temporary focus');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await temporary.evaluate(el => document.activeElement === el), true, 'Shift+Tab must return to temporary focus');
    } else if (moved) await page.getByRole('button', { name: 'Close settings' }).focus();
    const expected = role === 'admin' && !profileError ? section : 'appearance';
    await page.locator(`.settings-navigation nav button[aria-current="page"]`).filter({ hasText: expected === 'appearance' ? 'Appearance & language' : section === 'users' ? 'Users' : 'Models & routing' }).waitFor({ state: 'attached' });
    if (role !== 'admin' || profileError) await page.waitForURL('**/settings/appearance');
    const result = await page.evaluate(() => {
      const active = document.activeElement;
      const current = document.querySelector('.settings-navigation nav [aria-current="page"]');
      return {
        focus: active?.textContent?.trim().slice(0, 70),
        focusClass: active?.className,
        focusIsCurrent: active === current,
        focusIsDetail: active?.classList.contains('settings-detail-scroll'),
        focusIsClose: active?.getAttribute('aria-label') === 'Close settings',
        current: current?.textContent?.trim(),
        detail: document.querySelector('.settings-detail header span')?.textContent?.trim(),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    const name = `${width}-${theme}-${section}-${role}${moved ? '-moved' : ''}${cycled ? '-cycled' : ''}${profileError ? '-error' : ''}`;
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    assert.deepEqual(errors, [], `${name}: page errors`);
    assert.equal(result.overflow, false, `${name}: horizontal overflow`);
    if (moved) assert.equal(result.focusIsClose, true, `${name}: loading stole intentional focus: ${JSON.stringify(result)}`);
    else if (cycled) assert.equal(result.focus, 'Appearance & language', `${name}: loading stole focus after Tab/Shift+Tab: ${JSON.stringify(result)}`);
    else if (width > 820) assert.equal(result.focusIsCurrent, true, `${name}: initial focus missed current page: ${JSON.stringify(result)}`);
    else assert.equal(result.focusIsDetail, true, `${name}: narrow page focus missing: ${JSON.stringify(result)}`);
    return { name, result };
  } finally {
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const results = [];
  try {
    for (const width of [1440, 768, 390]) for (const theme of ['light', 'dark']) {
      results.push(await casePage(browser, { width, theme }));
      results.push(await casePage(browser, { width, theme, moved: true }));
      if (width === 1440) results.push(await casePage(browser, { width, theme, cycled: true }));
    }
    for (const section of ['models']) results.push(await casePage(browser, { width: 1440, theme: 'light', section }));
    results.push(await casePage(browser, { width: 1440, theme: 'light', role: 'member' }));
    results.push(await casePage(browser, { width: 1440, theme: 'dark', profileError: true }));
    console.log(`PASS settings admin deep-link focus: ${results.length} synthetic cases`);
  } finally {
    await browser.close(); await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
