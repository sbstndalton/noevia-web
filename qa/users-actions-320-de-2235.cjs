'use strict';
// #2235 follow-up: a member's actions in Settings → Users (Disable, Recovery, remove) are one group that wraps below the name. The group was
// `flex: none` and did not wrap itself, so with longer German labels at 320 px it ran past the card's clipped edge. Now it wraps inside the row.
// Synthetic /api/admin/users in the real shape; German locale (labels "Deaktivieren", "Wiederherstellung"), 320 px phone and 1440 px desktop.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_CORE_SERVER=<core server/>] [QA_SHOTS=<dir>] node qa/users-actions-320-de-2235.cjs
// Fails on a build without the change, passes with it.
const assert = require('node:assert/strict');
const { run, openPage, shot, ADMIN, IPHONE, DESKTOP } = require('./web-fixes-lib.cjs');

const member = { id: 'qa-member', username: 'qamember', displayName: 'QA Mitglied', role: 'member', diaryEnabled: false, onboarded: true, disabled: false };
const mock = (page) => page.route('**/api/admin/users', (r) => r.fulfill({ json: { users: [{ ...ADMIN, disabled: false }, member] } }));
const PHONE_320 = { options: { ...IPHONE, viewport: { width: 320, height: 640 }, locale: 'de-DE' } };
const DESKTOP_DE = { options: { ...DESKTOP, locale: 'de-DE' } };

run('users-actions-320-de-2235', Number(process.env.QA_PORT || 32236), async (check, browser, origin) => {
  for (const theme of ['light', 'dark']) {
    await check(`320 px German ${theme}: Disable, Recovery and remove stay inside the card, one group, no sideways scroll`, async () => {
      const { page, context, errors } = await openPage(browser, PHONE_320, theme, { mock });
      await page.goto(`${origin}/settings/users`);
      const row = page.locator('.settings-users .model-row').filter({ hasText: '@qamember' });
      await row.waitFor({ timeout: 15000 });
      const m = await row.evaluate((el) => {
        const card = el.closest('.set-rows').getBoundingClientRect();
        const btns = [...el.querySelectorAll('.users-actions button')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim() || b.getAttribute('aria-label'), left: r.left, right: r.right }; });
        return { btns, cardLeft: card.left, cardRight: card.right, docW: document.documentElement.scrollWidth, vw: innerWidth };
      });
      assert.equal(m.btns.length, 3);
      for (const b of m.btns) assert.ok(b.left >= m.cardLeft - 0.5 && b.right <= m.cardRight + 0.5, `"${b.text}" spans ${Math.round(b.left)}–${Math.round(b.right)} px, outside the card ${Math.round(m.cardLeft)}–${Math.round(m.cardRight)} px`);
      assert.ok(m.docW <= m.vw, `the page scrolls sideways (${m.docW} of ${m.vw} px)`);
      assert.match(await row.textContent(), /Deaktivieren/, 'the German labels are in use');
      await shot(page, `2235-users-320-de-${theme}`, { fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
  await check('1440 px German light: the Users list reads as before (actions at the right of the row)', async () => {
    const { page, context } = await openPage(browser, DESKTOP_DE, 'light', { mock });
    await page.goto(`${origin}/settings/users`);
    const row = page.locator('.settings-users .model-row').filter({ hasText: '@qamember' });
    await row.waitFor({ timeout: 15000 });
    const m = await row.evaluate((el) => { const r = el.getBoundingClientRect(), a = el.querySelector('.users-actions').getBoundingClientRect(); return { rowRight: r.right, actionsRight: a.right, actionsTop: a.top, rowTop: r.top, rowH: r.height, actionsH: a.height }; });
    assert.ok(m.rowRight - m.actionsRight < 40, 'the actions sit at the row\'s right edge');
    assert.ok(m.actionsH < m.rowH, 'the actions share a line with the name on a desktop');
    await page.waitForTimeout(600);
    await shot(page, '2235-users-1440-de-light');
    await context.close();
  });
});
