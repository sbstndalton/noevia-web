'use strict';
// sbstndalton/noevia#2399: sidebar search. (1) A query over 200 characters is refused by GET /api/chats/search (400); the
// sidebar read that as "No matching chats…". It now says the limit. (2) A query matching more than 100 chats comes back
// with truncated:true; the sidebar now says that more chats match than are shown. Fails on a build of main, passes with
// the change. Mocked /api/workspace and /api/chats/search.
const assert = require('node:assert/strict');
const { themedPage, shot, run } = require('./ui-batch-harness.cjs');

const freeChats = Array.from({ length: 4 }, (_, i) => ({ id: `qa2399-${i}`, title: `QA-2399 synthetic chat ${i}`, updatedAt: 5000 - i, archived: false, pinned: false }));
const TOO_LONG = 'x'.repeat(201);

async function openSearch(page, origin) {
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  const searches = [];
  await page.route('**/api/chats/search**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('q') || '';
    searches.push(q);
    if (q.length > 200) return r.fulfill({ status: 400, json: { error: 'Search for at most 200 characters.' } });
    if (q === 'many') return r.fulfill({ json: { chats: freeChats.map((c) => c.id), truncated: true } });
    return r.fulfill({ json: { chats: [], truncated: false } });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 20000 });
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const box = page.locator('input.shell-search').filter({ visible: true }).first();
  // On a phone the drawer shows the field itself; wider, the rail's search button opens it.
  const shown = await box.waitFor({ timeout: 6000 }).then(() => true, () => false);
  if (!shown) await page.getByRole('button', { name: 'Search noevia' }).filter({ visible: true }).first().click();
  await box.waitFor({ timeout: 15000 });
  return { box, searches };
}

run('search-limits-2399', Number(process.env.QA_PORT || 32399), async (check, browser, origin) => {
  for (const view of [[375, 812, 'light'], [375, 812, 'dark'], [768, 900, 'light'], [768, 900, 'dark']]) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: a query over 200 characters says the limit, not "No matching"`, async () => {
      const page = await themedPage(browser, view);
      try {
        const { box } = await openSearch(page, origin);
        await box.fill(TOO_LONG);
        await page.getByText('Search for at most 200 characters.').waitFor({ timeout: 5000 });
        assert.equal(await page.getByText('No matching chats, projects or pages.').count(), 0);
        await shot(page, `search-201-${view[0]}-${view[2]}`);
        // Back under the limit, the hint goes and the ordinary empty result returns.
        await box.fill('x'.repeat(200));
        await page.getByText('No matching chats, projects or pages.').waitFor({ timeout: 5000 });
        assert.equal(await page.getByText('Search for at most 200 characters.').count(), 0);
      } finally { await page.close(); }
    });
    await check(`${tag}: truncated results are signalled`, async () => {
      const page = await themedPage(browser, view);
      try {
        const { box, searches } = await openSearch(page, origin);
        await box.fill('many');
        await page.getByText('More chats match in their messages than can be shown. Narrow the search to see them all.').waitFor({ timeout: 5000 });
        assert.ok(searches.includes('many'));
        await shot(page, `search-truncated-${view[0]}-${view[2]}`);
        await box.fill('qa');
        await page.waitForFunction(() => !document.body.textContent.includes('More chats match in their messages'), null, { timeout: 5000 });
      } finally { await page.close(); }
    });
  }
});
