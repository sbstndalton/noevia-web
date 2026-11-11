'use strict';
// sbstndalton/noevia#2401 (second half): while a search is typed, the matching chats were listed under the "Recent chats" heading,
// which reads as recents rather than results. The heading now says "Matching chats" while there is a query and goes back
// to "Recent chats" when it is cleared. Fails on a build of main, passes with the change. 375 and 768 px, light and dark.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

const freeChats = ['alpha', 'bravo', 'charlie'].map((n, i) => ({ id: `qa2401-${n}`, title: `QA-2401 ${n} notes`, updatedAt: 5000 - i, archived: false, pinned: false }));

run('search-heading-2401', Number(process.env.QA_PORT || 32402), async (check, browser, origin) => {
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: results sit under "Matching chats", not "Recent chats"`, async () => {
      const page = await themedPage(browser, view);
      try {
        await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
        await page.route('**/api/chats/search**', (r) => r.fulfill({ json: { chats: [], truncated: false } }));
        await page.goto(origin);
        await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 20000 });
        const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
        if (await toggle.isVisible()) await toggle.click();
        const box = page.locator('input.shell-search').filter({ visible: true }).first();
        if (!(await box.waitFor({ timeout: 6000 }).then(() => true, () => false))) await page.getByRole('button', { name: 'Search noevia' }).filter({ visible: true }).first().click();
        await box.waitFor({ timeout: 15000 });
        await page.getByRole('button', { name: 'Recent chats', exact: true }).waitFor({ timeout: 10000 });
        await box.fill('bravo');
        await page.getByRole('button', { name: 'Matching chats', exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole('button', { name: 'Recent chats', exact: true }).count(), 0, 'no "Recent chats" heading over results');
        await page.getByText('QA-2401 bravo notes').first().waitFor();
        await shot(page, `search-heading-${view[0]}-${view[2]}`);
        await box.fill('');
        await page.getByRole('button', { name: 'Recent chats', exact: true }).waitFor({ timeout: 5000 });
      } finally { await page.close(); }
    });
  }
});
