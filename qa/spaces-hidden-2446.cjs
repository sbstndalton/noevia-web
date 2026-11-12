'use strict';
// sbstndalton/noevia#2446 (Spaces): the area is shown only when GET /api/spaces answers 200 for this account. On a 404 (a
// server without the routes), a 500, or a 200 that is not the list, the sidebar has no Spaces entry and the paths show the
// normal "This page isn't here" view. With the routes there, the entry exists and opens the library.
const assert = require('node:assert/strict');
const { themedPage, shot, run, VIEWS, createSpacesServer, mountSpaces, open, openNav } = require('./spaces-harness.cjs');

const entry = (page) => page.getByRole('button', { name: 'Spaces', exact: true });

run('spaces-hidden-2446', Number(process.env.QA_PORT || 32446), async (check, browser, origin) => {
  for (const view of VIEWS.filter((v, i) => i % 2 === 0 || v[0] === 768)) {
    const tag = `${view[0]} px ${view[2]}`;
    for (const capability of ['absent', 'broken']) {
      await check(`${tag}: ${capability}: no sidebar entry and /spaces reads as an unknown page`, async () => {
        const page = await themedPage(browser, view);
        try {
          const server = createSpacesServer({ capability });
          await mountSpaces(page, server);
          await open(page, origin, '/spaces');
          await page.getByText("This page isn't here").waitFor({ timeout: 10000 });
          await openNav(page);
          assert.equal(await entry(page).count(), 0, 'the sidebar must not offer Spaces');
          assert.equal(new URL(page.url()).pathname, '/spaces', 'the address is left as typed');
          await shot(page, `hidden-${capability}-${view[0]}-${view[2]}`);
          await page.goto(origin + '/spaces/5a5a5a5a-0000-4000-8000-000000000001/9e9e9e9e-0000-4000-8000-000000000002');
          await page.getByText("This page isn't here").waitFor({ timeout: 10000 });
        } finally { await page.close(); }
      });
    }
    await check(`${tag}: a 200 that is the app shell, not the list, is absent`, async () => {
      const page = await themedPage(browser, view);
      try {
        await page.route('**/api/spaces**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
        await open(page, origin, '/');
        await openNav(page);
        await page.waitForTimeout(800);
        assert.equal(await entry(page).count(), 0);
      } finally { await page.close(); }
    });
    await check(`${tag}: with the routes the entry is there and opens the library`, async () => {
      const page = await themedPage(browser, view);
      try {
        const server = createSpacesServer();
        server.addSpace('QA-2446 Research');
        await mountSpaces(page, server);
        await open(page, origin, '/');
        await openNav(page);
        await entry(page).waitFor({ timeout: 10000 });
        await entry(page).click();
        await page.getByRole('heading', { name: 'Spaces', exact: true, level: 1 }).waitFor({ timeout: 10000 });
        assert.equal(new URL(page.url()).pathname, '/spaces');
        await page.getByRole('button', { name: 'Open QA-2446 Research' }).waitFor();
      } finally { await page.close(); }
    });
  }
});
