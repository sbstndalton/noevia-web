'use strict';
// sbstndalton/noevia#2601: the sidebar search says "Search chats, projects and pages…" but found no Space page: it asked only
// /api/chats/search. The server searches pages one Space at a time (GET /api/spaces/{id}/pages?q=), so the search now asks each
// of the person's first Spaces and lists the matches under "Pages", each with its Space; a click opens the page. A name
// match and a text-only match both work, no match says so, and with the Spaces routes absent no page request is made.
// Offline: the fixture serves the build; /api/spaces and /api/chats/search are stubs.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=<dist> [QA_SHOTS=<dir>] node qa/space-page-search-2601.cjs
const assert = require('node:assert/strict');
const { themedPage, shot, run, createSpacesServer, mountSpaces, open, openNav } = require('./spaces-harness.cjs');

const VIEWS = [[375, 812, 'light'], [375, 812, 'dark'], [1280, 900, 'light'], [1280, 900, 'dark']];

async function openSearch(page) {
  await openNav(page);
  const field = page.getByRole('textbox', { name: 'Search noevia' });
  if (!(await field.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Search noevia' }).filter({ visible: true }).first().click();
  await field.waitFor({ timeout: 10000 });
  return field;
}

run('space-page-search-2601', Number(process.env.QA_PORT || 32601), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: a page is found by title and by its text, listed with its Space, and opens on a click`, async () => {
      const page = await themedPage(browser, view);
      const server = createSpacesServer();
      const d1 = server.addSpace('QA space D1');
      const other = server.addSpace('QA space D2');
      server.addPage(d1.id, 'QA page d1', 'first body');
      server.addPage(other.id, 'QA notes', 'a line with the QA-2601 needle in it');
      let chatSearches = 0;
      try {
        await page.route('**/api/chats/search**', (r) => { chatSearches++; return r.fulfill({ json: { chats: [], truncated: false } }); });
        await mountSpaces(page, server);
        await open(page, origin, '/');
        const field = await openSearch(page);
        await field.fill('QA page d1');
        const hit = page.getByRole('button', { name: 'QA page d1, in QA space D1', exact: true });
        await hit.waitFor({ timeout: 10000 });
        assert.ok(chatSearches >= 1, 'chats are still searched');
        assert.equal(await page.getByText('No matching chats, projects or pages.').count(), 0);
        assert.equal(await page.locator('.side-scroll-pages .section-label').innerText(), 'Pages');
        await shot(page, `space-page-search-title-${view[0]}-${view[2]}`);
        // Text only: the title does not hold the words, the page body does.
        await field.fill('QA-2601 needle');
        await page.getByRole('button', { name: 'QA notes, in QA space D2', exact: true }).waitFor({ timeout: 10000 });
        assert.equal(await page.getByRole('button', { name: /QA page d1/ }).count(), 0, 'a page that does not match is not listed');
        // Keyboard: ArrowDown from the field reaches the page row.
        await field.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label')), 'QA notes, in QA space D2');
        // A click opens that page in its Space and closes the search.
        await page.getByRole('button', { name: 'QA notes, in QA space D2', exact: true }).click();
        await page.waitForURL(new RegExp(`/spaces/${other.id}/`), { timeout: 10000 });
        assert.equal(await page.getByRole('textbox', { name: 'Search noevia' }).count() === 0 || !(await page.getByRole('textbox', { name: 'Search noevia' }).isVisible()), true, 'the search closes');
      } finally { await page.close(); }
    });
    await check(`${tag}: no match says so, then a second search finds another Space’s page`, async () => {
      const page = await themedPage(browser, view);
      const server = createSpacesServer();
      const a = server.addSpace('QA space A');
      server.addSpace('QA space B');
      server.addPage(a.id, 'QA alpha page', 'x');
      try {
        await page.route('**/api/chats/search**', (r) => r.fulfill({ json: { chats: [], truncated: false } }));
        await mountSpaces(page, server);
        await open(page, origin, '/');
        const field = await openSearch(page);
        await field.fill('QA-2601 nothing like this');
        await page.getByText('No matching chats, projects or pages.').waitFor({ timeout: 10000 });
        await shot(page, `space-page-search-none-${view[0]}-${view[2]}`);
        await field.fill('QA alpha');
        await page.getByRole('button', { name: 'QA alpha page, in QA space A', exact: true }).waitFor({ timeout: 10000 });
        await shot(page, `space-page-search-hit-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
  await check('with the Spaces routes absent, a search makes no page request and shows no Pages group', async () => {
    const page = await themedPage(browser, [1280, 900, 'light']);
    const server = createSpacesServer({ capability: 'absent' });
    try {
      await page.route('**/api/chats/search**', (r) => r.fulfill({ json: { chats: [], truncated: false } }));
      await mountSpaces(page, server);
      await open(page, origin, '/');
      const field = await openSearch(page);
      await field.fill('QA page d1');
      await page.getByText('No matching chats, projects or pages.').waitFor({ timeout: 10000 });
      await page.waitForTimeout(800);
      assert.deepEqual(server.calls.filter((c) => /\/pages/.test(c.path)), [], 'no page search request');
      assert.equal(await page.locator('.side-scroll-pages').count(), 0);
    } finally { await page.close(); }
  });
});
