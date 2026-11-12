'use strict';
// sbstndalton/noevia#2446 (Spaces): the library. Create, rename and delete a Space (a non-empty one asks and sends
// withPages; a stale list revision reloads and says so), pages as grid and list, the search limit (201 characters is not
// sent, and says the limit) and the truncated note, empty and error states. Mocked /api/spaces.
const assert = require('node:assert/strict');
const { themedPage, shot, run, VIEWS, createSpacesServer, mountSpaces, open, openNav } = require('./spaces-harness.cjs');

async function seeded(browser, origin, view, route = '/spaces', setup = () => undefined) {
  const page = await themedPage(browser, view);
  const server = createSpacesServer();
  setup(server);
  await mountSpaces(page, server);
  await open(page, origin, route);
  return { page, server };
}

run('spaces-library-2446', Number(process.env.QA_PORT || 32447), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;
    await check(`${tag}: empty library offers a first Space; create → opens it; rename; delete asks`, async () => {
      const { page, server } = await seeded(browser, origin, view);
      try {
        await page.getByText('No Spaces yet').waitFor({ timeout: 10000 });
        await shot(page, `library-empty-${view[0]}-${view[2]}`);
        await page.getByRole('button', { name: 'New space' }).click();
        const dialog = page.getByRole('dialog', { name: 'New space' });
        await dialog.waitFor();
        // The limit is a count, and an empty name is refused before any request.
        await dialog.getByRole('button', { name: 'Create' }).click();
        await dialog.getByText('Give the Space a name.').waitFor();
        assert.equal(server.calls.filter((c) => c.method === 'POST').length, 0);
        await dialog.getByLabel('Space name').fill('x'.repeat(81));
        await dialog.getByText('Use a name of at most 80 characters.').waitFor();
        await dialog.getByLabel('Space name').fill('QA-2446 Notes');
        await dialog.getByRole('button', { name: 'Create' }).click();
        await page.getByRole('heading', { name: 'QA-2446 Notes', level: 1 }).waitFor({ timeout: 10000 });
        assert.match(new URL(page.url()).pathname, /^\/spaces\/5a5a5a5a-/);
        await page.getByText('Create the first page in this Space.').waitFor();
        await shot(page, `pages-empty-${view[0]}-${view[2]}`);
        // Rename from the Space page.
        await page.getByRole('button', { name: 'Rename' }).first().click();
        const rename = page.getByRole('dialog', { name: 'Rename space' });
        await rename.getByLabel('Space name').fill('QA-2446 Renamed');
        await rename.getByRole('button', { name: 'Save' }).click();
        await page.getByRole('heading', { name: 'QA-2446 Renamed', level: 1 }).waitFor({ timeout: 10000 });
        assert.equal(server.spaces[0].name, 'QA-2446 Renamed');
        assert.equal(server.calls.find((c) => c.method === 'PATCH').body.revision >= 1, true, 'the list revision travels with the write');
        // An empty Space deletes after one confirmation, without withPages.
        await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
        const confirm = page.getByRole('dialog', { name: 'Delete QA-2446 Renamed?' });
        await confirm.getByText('This Space has no pages.').waitFor();
        await confirm.getByRole('button', { name: 'Delete Space' }).click();
        await page.getByText('No Spaces yet').waitFor({ timeout: 10000 });
        assert.equal(server.calls.find((c) => c.method === 'DELETE').body.withPages, undefined);
        assert.match(new URL(page.url()).pathname, /^\/spaces$/);
      } finally { await page.close(); }
    });

    await check(`${tag}: deleting a Space that has pages asks and sends withPages; a stale revision reloads and says so`, async () => {
      const { page, server } = await seeded(browser, origin, view, '/spaces', (s) => { const sp = s.addSpace('QA-2446 Full'); s.addPage(sp.id, 'QA page', 'text'); s.addSpace('QA-2446 Other'); });
      try {
        await page.getByRole('button', { name: 'Open QA-2446 Full' }).waitFor({ timeout: 10000 });
        await shot(page, `library-cards-${view[0]}-${view[2]}`);
        // Another tab renames something: our list revision is now stale.
        server.revision += 5;
        await page.getByRole('button', { name: 'Delete: QA-2446 Other' }).click();
        await page.getByRole('dialog', { name: 'Delete QA-2446 Other?' }).getByRole('button', { name: 'Delete Space' }).click();
        await page.getByText('Spaces changed somewhere else. The list was reloaded; try again.').waitFor({ timeout: 10000 });
        assert.equal(server.spaces.length, 2, 'a stale delete removes nothing');
        // On the fresh list the non-empty delete asks with the pages in the question.
        await page.getByRole('button', { name: 'Delete: QA-2446 Full' }).click();
        const confirm = page.getByRole('dialog', { name: 'Delete QA-2446 Full?' });
        await confirm.getByText('This Space still has pages. Deleting it deletes them too, and that cannot be undone.').waitFor();
        await shot(page, `delete-with-pages-${view[0]}-${view[2]}`);
        await confirm.getByRole('button', { name: 'Delete Space' }).click();
        await page.getByRole('button', { name: 'Open QA-2446 Full' }).waitFor({ state: 'detached', timeout: 10000 });
        assert.equal(server.calls.filter((c) => c.method === 'DELETE').pop().body.withPages, true);
      } finally { await page.close(); }
    });

    await check(`${tag}: pages as grid and list, search, the 200-character limit and the truncated note`, async () => {
      let sid;
      const { page, server } = await seeded(browser, origin, view, '/spaces', (s) => {
        sid = s.addSpace('QA-2446 Pages').id;
        s.addPage(sid, 'QA alpha plan', 'rollout details'); s.addPage(sid, 'QA beta notes', 'alpha mention'); s.addPage(sid, 'QA gamma', 'other', 'coworker-1');
      });
      try {
        await page.getByRole('button', { name: 'Open QA-2446 Pages' }).click();
        await page.getByRole('button', { name: 'QA alpha plan' }).waitFor({ timeout: 10000 });
        await page.getByText('3 pages').waitFor();
        await page.getByText('Written by a coworker').waitFor();
        await shot(page, `pages-grid-${view[0]}-${view[2]}`);
        await page.getByRole('button', { name: 'List view' }).click();
        assert.equal(await page.locator('.space-pages.list').count(), 1);
        await shot(page, `pages-list-${view[0]}-${view[2]}`);
        const box = page.getByRole('searchbox', { name: 'Search pages' });
        await box.fill('alpha');
        await page.getByRole('heading', { name: 'Matching pages' }).waitFor({ timeout: 5000 });
        await page.getByText('2 pages').waitFor();
        // Over the limit: nothing is sent, and the limit is said.
        const before = server.calls.length;
        await box.fill('x'.repeat(201));
        await page.getByText('Search for at most 200 characters.').waitFor({ timeout: 5000 });
        await page.waitForTimeout(600);
        assert.equal(server.calls.slice(before).filter((c) => c.path.includes('q=xxxx')).length, 0, 'a 201-character query is never sent');
        assert.equal(await page.getByText('No matching pages').count(), 0);
        await shot(page, `search-limit-${view[0]}-${view[2]}`);
        await box.fill('x'.repeat(200));
        await page.getByText('No matching pages').waitFor({ timeout: 5000 });
        assert.ok(server.calls.some((c) => c.path.includes('q=' + 'x'.repeat(200))), 'exactly 200 characters is sent');
        // The server says more match than it returned.
        server.forceTruncated = true;
        await box.fill('QA');
        await page.getByText('Only the first matches are shown. Narrow the search to see the rest.').waitFor({ timeout: 5000 });
        await shot(page, `search-truncated-${view[0]}-${view[2]}`);
        await box.fill('');
        await page.waitForFunction(() => !document.body.textContent.includes('Only the first matches'), null, { timeout: 5000 });
      } finally { await page.close(); }
    });

    await check(`${tag}: a failed load says so with a retry, and recovers`, async () => {
      const page = await themedPage(browser, view);
      try {
        const server = createSpacesServer();
        server.addSpace('QA-2446 Back');
        // The capability probe (the first GET /api/spaces) passes; the library's own read fails until we let it through.
        let reads = 0, healthy = false;
        await page.route('**/api/spaces**', (r) => {
          const isList = r.request().method() === 'GET' && new URL(r.request().url()).pathname === '/api/spaces';
          if (isList && ++reads > 1 && !healthy) return r.fulfill({ status: 500, json: { error: 'boom' } });
          return server.handle(r);
        });
        await open(page, origin, '/spaces');
        await page.getByText('Spaces could not be loaded').waitFor({ timeout: 10000 });
        await shot(page, `library-error-${view[0]}-${view[2]}`);
        healthy = true;
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.getByRole('button', { name: 'Open QA-2446 Back' }).waitFor({ timeout: 10000 });
      } finally { await page.close(); }
    });
  }
});
