'use strict';
// sbstndalton/noevia#2401: on a narrow screen Settings moves focus into the detail panel when a page opens, and the whole panel
// showed a blue focus frame. Focus the code put there, or a tap put there, draws no ring; focus that arrives because the person
// used the keyboard (Enter on a list row) still does. Mocked retention call only. Fails on a build of main, passes with the
// change. 375 and 768 px, light and dark.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

const ring = (page) => page.evaluate(() => {
  const el = document.activeElement, cs = getComputedStyle(el);
  return { onPanel: el.classList.contains('settings-detail-scroll'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
});
const hasRing = (r) => r.style !== 'none' && r.width > 0;

async function openList(browser, origin, view) {
  const page = await themedPage(browser, view);
  await page.route('**/api/account/retention', (route) => route.fulfill({ json: { days: 0, periods: [30, 90, 365], preview: { 30: 0, 90: 0, 365: 0 } } }));
  await page.goto(`${origin}/settings`);
  // A phone opens on the current page; the way back to the list is the header's chevron.
  await page.getByRole('button', { name: 'All settings', exact: true }).click({ timeout: 20000 });
  const row = page.getByRole('button', { name: 'Your data and privacy', exact: true });
  await row.waitFor({ timeout: 20000 });
  return { page, row };
}

run('settings-panel-focus-2401', Number(process.env.QA_PORT || 32401), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: a page opened by a tap or click shows no frame on the panel`, async () => {
      const { page, row } = await openList(browser, origin, view);
      try {
        await row.click();
        await page.getByText('Delete old chats').waitFor({ timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.classList.contains('settings-detail-scroll'), null, { timeout: 5000 });
        const r = await ring(page);
        assert.ok(r.onPanel);
        assert.equal(hasRing(r), false, `the panel draws an outline (${r.style} ${r.width}px)`);
        await shot(page, `settings-data-click-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
    await check(`${tag}: a page opened with the keyboard still shows where focus is`, async () => {
      const { page, row } = await openList(browser, origin, view);
      try {
        await row.focus();
        await page.keyboard.press('Enter');
        await page.getByText('Delete old chats').waitFor({ timeout: 10000 });
        await page.waitForFunction(() => document.activeElement?.classList.contains('settings-detail-scroll'), null, { timeout: 5000 });
        const r = await ring(page);
        assert.equal(hasRing(r), true, 'keyboard focus on the panel keeps its ring');
        await shot(page, `settings-data-keyboard-${view[0]}-${view[2]}`);
        // Once the person uses the keyboard on the panel (or tabs on) the state is theirs: Tab leaves and the ring goes with the focus.
        await page.keyboard.press('Tab');
        assert.equal((await ring(page)).onPanel, false);
      } finally { await page.close(); }
    });
  }
  await check('opening a deep link (no input yet) shows no frame', async () => {
    const page = await themedPage(browser, VIEWS[1]);
    try {
      await page.route('**/api/account/retention', (route) => route.fulfill({ json: { days: 0, periods: [30, 90, 365], preview: { 30: 0, 90: 0, 365: 0 } } }));
      await page.goto(`${origin}/settings/data`);
      await page.getByText('Delete old chats').waitFor({ timeout: 20000 });
      await page.waitForFunction(() => document.activeElement?.classList.contains('settings-detail-scroll'), null, { timeout: 5000 });
      assert.equal(hasRing(await ring(page)), false);
      // A key press on the panel is the person's own input: the frame comes back so they can see where they are.
      await page.keyboard.press('ArrowDown');
      assert.equal(hasRing(await ring(page)), true, 'the frame returns once the keyboard is used on the panel');
    } finally { await page.close(); }
  });
});
