'use strict';
// sbstndalton/noevia#2446 (Spaces): the page editor. create → edit → autosave (1.5 s after the last change) → reload; a 409
// offers "keep mine" (saved on the new version) and "take theirs" (reload) and never overwrites; a failed save keeps the
// draft on this device and a reload brings it back; leaving with unsaved changes warns; the 512 KiB limit is checked
// before sending; delete asks. Mocked /api/spaces (revision rule: version = sha256(content), a stale write is a 409).
const assert = require('node:assert/strict');
const { themedPage, shot, run, VIEWS, createSpacesServer, mountSpaces, open } = require('./spaces-harness.cjs');

const status = (page) => page.locator('[data-save-state]');
const isState = (page, text) => status(page).filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) });
const title = (page) => page.getByLabel('Page title');
const body = (page) => page.getByLabel('Page content, in Markdown');
const draftKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('noevia:space-page-draft:')));
const puts = (server) => server.calls.filter((c) => c.method === 'PUT');

async function withPage(browser, origin, view, fn, { content = 'first draft' } = {}) {
  const page = await themedPage(browser, view);
  const server = createSpacesServer();
  const space = server.addSpace('QA-2446 Space');
  const seeded = server.addPage(space.id, 'QA-2446 Plan', content);
  await mountSpaces(page, server);
  await open(page, origin, `/spaces/${space.id}/${seeded.id}`);
  await body(page).waitFor({ timeout: 15000 });
  try { await fn({ page, server, space, seeded }); } finally { await page.close(); }
}

run('spaces-editor-2446', Number(process.env.QA_PORT || 32448), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;

    await check(`${tag}: new page → type → autosaves 1.5 s after the last change, shows the state, survives a reload`, async () => {
      const page = await themedPage(browser, view);
      const server = createSpacesServer();
      const space = server.addSpace('QA-2446 Space');
      await mountSpaces(page, server);
      try {
        await open(page, origin, `/spaces/${space.id}`);
        await page.getByRole('button', { name: 'New page' }).first().click();
        await body(page).waitFor({ timeout: 10000 });
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ? 'field' : ''), 'field', 'a new page opens with the title field focused');
        await title(page).fill('QA-2446 Plan');
        await body(page).fill('# Plan\n\nfirst draft');
        await isState(page, 'Unsaved changes').waitFor();
        const typedAt = Date.now();
        await page.waitForTimeout(1000);
        assert.equal(puts(server).length, 0, 'nothing is sent before the autosave delay');
        await isState(page, 'Saved').waitFor({ timeout: 6000 });
        const waited = Date.now() - typedAt;
        assert.ok(waited >= 1400, `saved after ${waited} ms: the delay is 1.5 s after the last change`);
        assert.equal(puts(server).length, 1);
        assert.equal(puts(server)[0].body.content, '# Plan\n\nfirst draft');
        assert.equal(puts(server)[0].body.title, 'QA-2446 Plan');
        await shot(page, `editor-saved-${view[0]}-${view[2]}`);
        await page.reload();
        await body(page).waitFor({ timeout: 15000 });
        assert.equal(await body(page).inputValue(), '# Plan\n\nfirst draft');
        assert.equal(await title(page).inputValue(), 'QA-2446 Plan');
        // The preview renders the Markdown.
        await page.getByRole('button', { name: 'Preview' }).click();
        await page.getByRole('heading', { name: 'Plan', level: 1 }).waitFor();
        await page.getByRole('button', { name: 'Write' }).click();
        assert.deepEqual(await draftKeys(page), [], 'a saved page leaves no draft behind');
      } finally { await page.close(); }
    });

    await check(`${tag}: a 409 never overwrites; keep mine saves on the new version; take theirs reloads`, async () => {
      await withPage(browser, origin, view, async ({ page, server, space, seeded }) => {
        server.changeElsewhere(space.id, seeded.id, 'their first edit');
        await body(page).fill('my edit');
        await page.getByRole('alert').filter({ hasText: 'This page changed somewhere else' }).waitFor({ timeout: 6000 });
        await isState(page, 'Needs your decision').waitFor();
        assert.equal(server.pages.get(space.id)[0].content, 'their first edit', 'the newer text is untouched');
        assert.equal((await draftKeys(page)).length, 1, 'the draft is kept on this device');
        // The conflict appears while the person may be typing: it must not take focus from the text.
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'TEXTAREA');
        await page.keyboard.type(' plus');
        assert.equal(await body(page).inputValue(), 'my edit plus', 'typing carries on through a conflict');
        await shot(page, `editor-conflict-${view[0]}-${view[2]}`);
        await page.getByRole('button', { name: 'Keep mine' }).click();
        await isState(page, 'Saved').waitFor({ timeout: 6000 });
        assert.equal(server.pages.get(space.id)[0].content, 'my edit plus');
        assert.equal(puts(server).filter((c) => c.body.version === server.pages.get(space.id)[0].version).length, 0);
        assert.deepEqual(await draftKeys(page), []);
        // Second conflict: take theirs.
        server.changeElsewhere(space.id, seeded.id, 'their second edit');
        await body(page).fill('my second edit');
        await page.getByRole('button', { name: 'Take theirs' }).waitFor({ timeout: 6000 });
        await page.getByRole('button', { name: 'Take theirs' }).click();
        await isState(page, 'Saved').waitFor({ timeout: 6000 });
        assert.equal(await body(page).inputValue(), 'their second edit');
        assert.equal(server.pages.get(space.id)[0].content, 'their second edit');
        assert.deepEqual(await draftKeys(page), []);
      });
    });

    await check(`${tag}: a failed save keeps the draft; Try again saves; a reload after a failure restores it`, async () => {
      await withPage(browser, origin, view, async ({ page, server, space }) => {
        server.forceSaveFailure = true;
        await body(page).fill('typed while the server is down');
        await isState(page, 'Not saved').waitFor({ timeout: 6000 });
        await page.getByRole('alert').filter({ hasText: 'could not be saved' }).waitFor();
        assert.equal((await draftKeys(page)).length, 1);
        await shot(page, `editor-error-${view[0]}-${view[2]}`);
        // The tab goes away and comes back while the server is still down: the text is restored from this device.
        await page.reload();
        await body(page).waitFor({ timeout: 15000 });
        await page.getByText('Unsaved changes from this device were restored.').waitFor();
        assert.equal(await body(page).inputValue(), 'typed while the server is down');
        server.forceSaveFailure = false;
        await isState(page, 'Saved').waitFor({ timeout: 8000 });
        assert.equal(server.pages.get(space.id)[0].content, 'typed while the server is down');
        assert.deepEqual(await draftKeys(page), []);
      });
    });

    await check(`${tag}: leaving with unsaved changes warns (tab close, and the Back button after a failure)`, async () => {
      await withPage(browser, origin, view, async ({ page, server, space }) => {
        const warns = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
        assert.equal(await warns(), false, 'nothing to lose, no warning');
        server.hangSave = true;
        await body(page).fill('unsaved text');
        assert.equal(await warns(), true, 'unsaved text warns');
        server.hangSave = false; server.forceSaveFailure = true;
        await isState(page, 'Not saved').waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'QA-2446 Space' }).click();
        const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
        await dialog.waitFor();
        await page.waitForTimeout(400);
        await shot(page, `editor-leave-${view[0]}-${view[2]}`);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        assert.equal(await body(page).inputValue(), 'unsaved text');
        await page.getByRole('button', { name: 'QA-2446 Space' }).click();
        await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Leave' }).click();
        await page.getByRole('heading', { name: 'QA-2446 Space', level: 1 }).waitFor({ timeout: 10000 });
        assert.equal((await draftKeys(page)).length, 1, 'the text stays on this device');
        await page.getByRole('button', { name: 'QA-2446 Plan' }).click();
        await page.getByText('Unsaved changes from this device were restored.').waitFor({ timeout: 10000 });
        assert.equal(await body(page).inputValue(), 'unsaved text');
        void space;
      });
    });

    await check(`${tag}: a page deleted elsewhere: the text is not lost, it can be saved as a new page`, async () => {
      await withPage(browser, origin, view, async ({ page, server, space }) => {
        server.pages.set(space.id, []);
        await body(page).fill('written after the page was deleted elsewhere');
        await page.getByRole('alert').filter({ hasText: 'was deleted somewhere else' }).waitFor({ timeout: 6000 });
        assert.equal(await page.getByRole('button', { name: 'Try saving again' }).count(), 0, 'retrying a deleted page can only fail again');
        await shot(page, `editor-deleted-elsewhere-${view[0]}-${view[2]}`);
        await page.getByRole('button', { name: 'Save as a new page' }).click();
        await isState(page, 'Saved').waitFor({ timeout: 8000 }).catch(() => undefined);
        await page.waitForFunction(() => document.querySelector('textarea')?.value === 'written after the page was deleted elsewhere', null, { timeout: 8000 });
        const pages = server.pages.get(space.id);
        assert.equal(pages.length, 1);
        assert.equal(pages[0].content, 'written after the page was deleted elsewhere');
        assert.deepEqual(await draftKeys(page), [], 'nothing left behind for the page that is gone');
      });
    });

    await check(`${tag}: a page over 512 KiB is not sent; the text stays; shrinking it saves`, async () => {
      await withPage(browser, origin, view, async ({ page, server }) => {
        await body(page).fill('a'.repeat(512 * 1024 + 1));
        await isState(page, 'Not saved').waitFor({ timeout: 6000 });
        await page.getByRole('alert').filter({ hasText: 'cannot be saved' }).waitFor();
        assert.equal(puts(server).length, 0);
        await shot(page, `editor-too-large-${view[0]}-${view[2]}`);
        await body(page).fill('small again');
        await isState(page, 'Saved').waitFor({ timeout: 6000 });
        assert.equal(puts(server).length, 1);
      });
    });

    await check(`${tag}: delete asks, then the page is gone from the library`, async () => {
      await withPage(browser, origin, view, async ({ page, server, space }) => {
        await page.getByRole('button', { name: 'Delete page' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete QA-2446 Plan?' });
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        assert.equal(server.pages.get(space.id).length, 1);
        await page.getByRole('button', { name: 'Delete page' }).click();
        await page.getByRole('dialog', { name: 'Delete QA-2446 Plan?' }).getByRole('button', { name: 'Delete page' }).click();
        await page.getByText('No pages yet').waitFor({ timeout: 10000 });
        assert.equal(server.pages.get(space.id).length, 0);
        assert.deepEqual(await draftKeys(page), []);
      });
    });

    if (view[0] === 375) {
      await check(`${tag}: touch targets are at least 44 px, and nothing overflows sideways`, async () => {
        await withPage(browser, origin, view, async ({ page, space }) => {
          const small = await page.evaluate(() => [...document.querySelectorAll('.spaces-workspace button, .spaces-workspace input, .spaces-workspace textarea')]
            .filter((el) => el.getClientRects().length && !el.closest('.sr-only')).map((el) => [el, el.getBoundingClientRect()])
            .filter(([, r]) => r.height < 43.5 || r.width < 43.5).map(([el, r]) => `${el.tagName} ${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`));
          assert.deepEqual(small, [], 'every control is at least 44 x 44');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
          await page.getByRole('button', { name: 'QA-2446 Space' }).click();
          await page.getByRole('heading', { name: 'QA-2446 Space', level: 1 }).waitFor();
          const small2 = await page.evaluate(() => [...document.querySelectorAll('.spaces-workspace button, .spaces-workspace input')]
            .filter((el) => el.getClientRects().length && !el.closest('.sr-only')).map((el) => [el, el.getBoundingClientRect()])
            .filter(([, r]) => r.height < 43.5 || r.width < 43.5).map(([el, r]) => `${el.tagName} ${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`));
          assert.deepEqual(small2, [], 'the page library too');
          void space;
        });
      });
    }
  }
});
