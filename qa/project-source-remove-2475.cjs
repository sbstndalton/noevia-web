'use strict';
// sbstndalton/noevia#2475: Remove on a project source dropped it at once (a config POST, no question). It now asks first with
// the app's confirm dialog: the source's name in the text, a danger Remove button, Cancel focused. Cancel and Escape change
// nothing and send nothing; confirming sends exactly one update. 375 and 768 px, light and dark.
// Fails on a build of main (no dialog, one request at the first click), passes with the change.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

const NAME = 'qa-2475-notes.md';
const project = () => ({ id: 'qa2475', name: 'QA-2475 project', goal: '', instructions: '', memories: [], chats: [], updatedAt: 5000, files: [{ name: NAME, content: 'Synthetic source text.' }] });

run('project-source-remove-2475', Number(process.env.QA_PORT || 32475), async (check, browser, origin) => {
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: Remove asks first; Cancel and Escape send nothing; confirm sends one update`, async () => {
      const page = await themedPage(browser, view);
      try {
        let files = project().files;
        const writes = [];
        await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [{ ...project(), files }], freeChats: [] } }));
        await page.route('**/api/projects/qa2475/config', (r) => {
          const body = r.request().postDataJSON();
          writes.push(body);
          if (body.files) files = body.files;
          return r.fulfill({ json: { ok: true } });
        });
        await page.goto(origin);
        await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 20000 });
        const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
        if (await toggle.isVisible()) await toggle.click();
        await page.getByRole('button', { name: 'Open QA-2475 project', exact: true }).filter({ visible: true }).first().click();
        await page.getByRole('tab', { name: /^Sources/ }).click();
        const remove = page.getByRole('button', { name: `Remove ${NAME}`, exact: true });
        const dialog = page.getByRole('dialog');
        const settle = () => page.waitForTimeout(900); // past the 600 ms patch debounce

        // Cancel: the source stays, nothing is sent.
        await remove.click();
        await dialog.waitFor({ timeout: 3000 });
        assert.match(await dialog.textContent(), new RegExp(NAME), 'the dialog names the source');
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Cancel', 'Cancel has focus');
        const danger = dialog.locator('.btn-danger');
        assert.equal(await danger.textContent(), 'Remove', 'destructive button reads Remove');
        await shot(page, `source-remove-dialog-${view[0]}-${view[2]}`);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await settle();
        assert.equal(await dialog.count(), 0, 'dialog closed');
        assert.equal(writes.length, 0, 'Cancel sent a request');
        await remove.waitFor();

        // Escape: same.
        await remove.click();
        await dialog.waitFor({ timeout: 3000 });
        await page.keyboard.press('Escape');
        await settle();
        assert.equal(await dialog.count(), 0, 'dialog closed by Escape');
        assert.equal(writes.length, 0, 'Escape sent a request');
        await remove.waitFor();

        // Confirm: exactly one update, without the source.
        await remove.click();
        await dialog.waitFor({ timeout: 3000 });
        await dialog.locator('.btn-danger').click();
        await settle();
        assert.equal(writes.length, 1, `confirm sent ${writes.length} requests`);
        assert.deepEqual((writes[0].files || []).map((f) => f.name), [], 'the update drops the source');
        await remove.waitFor({ state: 'detached', timeout: 3000 });
      } finally { await page.close(); }
    });
  }
});
