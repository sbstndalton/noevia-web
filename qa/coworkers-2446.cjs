'use strict';
// sbstndalton/noevia#2446 (Coworkers): the list, create, the settings sheet (name, glyph, tint, instructions with their limit, Spaces
// granted, default Space, allowed tools when the server keeps them), delete with confirmation, a 409 `stale_revision` that reloads the
// record and keeps the person's edits, the conversation view (a plain note while `chatId` is null; the chat view under the coworker's
// header when it is set), and the capability gate (`GET /api/specialists`). Mocked /api/specialists and /api/spaces.
const assert = require('node:assert/strict');
const { themedPage, shot, run, VIEWS, createSpacesServer, mountSpaces, addSpecialists, mountSpecialists, open, openNav } = require('./spaces-harness.cjs');

async function setup(browser, origin, view, { route = '/coworkers', spaces = ['QA-2446 Research', 'QA-2446 Notes'], specialists = () => undefined, tools = false, capability = 'on' } = {}) {
  const page = await themedPage(browser, view);
  const server = createSpacesServer();
  const made = spaces.map((n) => server.addSpace(n));
  addSpecialists(server, { toolsSupported: tools, capability });
  const extra = specialists(server.sp, made);
  await mountSpaces(page, server);
  await mountSpecialists(page, server);
  await page.route('**/api/chats/chat-qa-**/history', (r) => r.fulfill({ json: { history: [], revision: null } }));
  await open(page, origin, typeof route === 'function' ? route(extra) : route);
  return { page, server, sp: server.sp, spaces: made, extra };
}
const sheet = (page, name) => page.getByRole('dialog', { name });
const patches = (sp) => sp.calls.filter((c) => c.method === 'PATCH');

run('coworkers-2446', Number(process.env.QA_PORT || 32450), async (check, browser, origin) => {
  for (const view of VIEWS) {
    const tag = `${view[0]} px ${view[2]}`;

    await check(`${tag}: empty list → create (name, glyph, tint, instructions, Spaces, default) → the coworker's page`, async () => {
      const { page, sp } = await setup(browser, origin, view);
      try {
        await page.getByText('No coworkers yet').waitFor({ timeout: 10000 });
        await shot(page, `coworkers-empty-${view[0]}-${view[2]}`);
        await page.getByRole('button', { name: 'New coworker' }).click();
        const dlg = sheet(page, 'New coworker');
        await dlg.waitFor();
        await dlg.getByRole('button', { name: 'Create' }).click();
        await dlg.getByText('Give the coworker a name.').waitFor();
        assert.equal(sp.calls.filter((c) => c.method === 'POST').length, 0, 'an empty name sends nothing');
        await dlg.getByLabel('Name', { exact: true }).fill('QA Researcher');
        await dlg.getByRole('button', { name: 'Use 🔎' }).click();
        await dlg.getByRole('button', { name: 'Blue' }).click();
        await dlg.getByLabel('Instructions').fill('Answer in two sentences.');
        await dlg.getByText('24 of 8000').waitFor();
        await dlg.getByText('Choosing tools arrives with the next server update.').waitFor();
        await dlg.getByRole('checkbox', { name: 'QA-2446 Research' }).check();
        await dlg.getByRole('checkbox', { name: 'QA-2446 Notes' }).check();
        await dlg.getByLabel('Default Space').selectOption({ label: 'QA-2446 Notes' });
        await page.waitForTimeout(400);
        await shot(page, `coworker-create-${view[0]}-${view[2]}`);
        await dlg.getByRole('button', { name: 'Create' }).click();
        await page.getByRole('heading', { name: 'QA Researcher', level: 1 }).waitFor({ timeout: 10000 });
        const post = sp.calls.find((c) => c.method === 'POST').body;
        assert.deepEqual({ name: post.name, glyph: post.glyph, tint: post.tint, brief: post.brief, spaces: post.spaces.length, hasDefault: !!post.defaultSpace, toolboxes: post.toolboxes }, { name: 'QA Researcher', glyph: '🔎', tint: 'primary', brief: 'Answer in two sentences.', spaces: 2, hasDefault: true, toolboxes: undefined });
        assert.match(new URL(page.url()).pathname, /^\/coworkers\/c0c0c0c0-/);
        await page.getByText('Can write to 2 Spaces · Default: QA-2446 Notes').waitFor();
        await page.getByText('The conversation is not ready yet').waitFor();
        await page.getByText('arrives with the next server update', { exact: false }).first().waitFor();
        assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).count(), 0, 'no composer without a conversation');
        await shot(page, `coworker-page-no-conversation-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });

    await check(`${tag}: settings round trip, the 8000-character limit, and 44 px targets`, async () => {
      const { page, sp } = await setup(browser, origin, view, { specialists: (s, spaces) => s.add({ spaces: [spaces[0].id], defaultSpace: spaces[0].id }), route: (c) => `/coworkers/${c.id}` });
      try {
        await page.getByRole('heading', { name: 'QA Researcher', level: 1 }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Settings for QA Researcher' }).click();
        const dlg = sheet(page, 'Coworker settings');
        await dlg.waitFor();
        await page.waitForTimeout(400);
        await shot(page, `coworker-settings-${view[0]}-${view[2]}`);
        // Over the limit: the count turns into a warning and nothing is sent.
        await dlg.getByLabel('Instructions').fill('b'.repeat(8001));
        await dlg.getByText('8001 of 8000').waitFor();
        await dlg.getByRole('button', { name: 'Save' }).click();
        await dlg.getByText('The instructions are over 8000 characters. Shorten them to save.').first().waitFor();
        assert.equal(patches(sp).length, 0);
        await shot(page, `coworker-brief-limit-${view[0]}-${view[2]}`);
        await dlg.getByLabel('Instructions').fill('b'.repeat(8000));
        await dlg.getByText('8000 of 8000').waitFor();
        await dlg.getByLabel('Instructions').fill('Use bullet points.');
        await dlg.getByRole('button', { name: 'Amber' }).click();
        await dlg.getByRole('checkbox', { name: 'QA-2446 Notes' }).check();
        if (view[0] === 375) {
          const small = await page.evaluate(() => [...document.querySelectorAll('.cw-settings button, .cw-settings input:not([type=checkbox]), .cw-settings select, .cw-settings textarea, .cw-check')]
            .filter((el) => el.getClientRects().length).map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.height < 43.5)
            .map(([el, r]) => `${el.tagName} ${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`));
          assert.deepEqual(small, [], 'every control in the sheet is at least 44 px tall');
        }
        await dlg.getByRole('button', { name: 'Save' }).click();
        await dlg.waitFor({ state: 'detached', timeout: 8000 });
        const sent = patches(sp)[0].body;
        assert.deepEqual(Object.keys(sent).sort(), ['brief', 'revision', 'spaces', 'tint'], 'only what changed, with the revision');
        assert.equal(sent.brief, 'Use bullet points.');
        await page.getByText('Can write to 2 Spaces').waitFor();
        // Reopen: the saved values are there.
        await page.getByRole('button', { name: 'Settings for QA Researcher' }).click();
        assert.equal(await sheet(page, 'Coworker settings').getByLabel('Instructions').inputValue(), 'Use bullet points.');
        assert.equal(await sheet(page, 'Coworker settings').getByRole('button', { name: 'Amber' }).getAttribute('aria-pressed'), 'true');
      } finally { await page.close(); }
    });

    await check(`${tag}: a 409 reloads the record and keeps the person's edits`, async () => {
      const { page, sp, extra } = await setup(browser, origin, view, { specialists: (s) => s.add({ glyph: '🔎' }), route: (c) => `/coworkers/${c.id}` });
      try {
        await page.getByRole('heading', { name: 'QA Researcher', level: 1 }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Settings for QA Researcher' }).click();
        const dlg = sheet(page, 'Coworker settings');
        await dlg.waitFor();
        sp.changeElsewhere(extra.id, { glyph: '🧭', brief: 'Changed by someone else.' });
        await dlg.getByLabel('Name', { exact: true }).fill('QA Reader');
        await dlg.getByRole('button', { name: 'Save' }).click();
        await dlg.getByText('This coworker was changed somewhere else.', { exact: false }).waitFor({ timeout: 8000 });
        assert.equal(await dlg.getByLabel('Name', { exact: true }).inputValue(), 'QA Reader', 'my edit is still in the form');
        assert.equal(await dlg.getByLabel('Instructions').inputValue(), 'Changed by someone else.', 'a field I did not touch shows the newer value');
        assert.equal(sp.list[0].name, 'QA Researcher', 'nothing was overwritten');
        await page.waitForTimeout(300);
        await shot(page, `coworker-stale-${view[0]}-${view[2]}`);
        await dlg.getByRole('button', { name: 'Save' }).click();
        await dlg.waitFor({ state: 'detached', timeout: 8000 });
        assert.equal(sp.list[0].name, 'QA Reader');
        assert.equal(sp.list[0].brief, 'Changed by someone else.');
        assert.equal(sp.list[0].glyph, '🧭');
        const second = patches(sp)[1].body;
        assert.deepEqual(second, { revision: sp.revision - 1, name: 'QA Reader' });
      } finally { await page.close(); }
    });

    await check(`${tag}: delete asks first, then the list no longer has the coworker`, async () => {
      const { page, sp } = await setup(browser, origin, view, { specialists: (s) => { s.add({ name: 'QA Keeper' }); return s.add({ name: 'QA Doomed' }); }, route: (c) => `/coworkers/${c.id}` });
      try {
        await page.getByRole('heading', { name: 'QA Doomed', level: 1 }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Settings for QA Doomed' }).click();
        await sheet(page, 'Coworker settings').getByRole('button', { name: 'Delete coworker' }).click();
        const confirm = page.getByRole('dialog', { name: 'Delete QA Doomed?' });
        await confirm.waitFor();
        await page.waitForTimeout(400);
        await shot(page, `coworker-delete-${view[0]}-${view[2]}`);
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        assert.equal(sp.list.length, 2);
        await sheet(page, 'Coworker settings').getByRole('button', { name: 'Delete coworker' }).click();
        await page.getByRole('dialog', { name: 'Delete QA Doomed?' }).getByRole('button', { name: 'Delete coworker' }).click();
        await page.getByRole('button', { name: 'Open QA Keeper' }).waitFor({ timeout: 10000 });
        assert.equal(sp.list.length, 1);
        assert.equal(new URL(page.url()).pathname, '/coworkers');
        await shot(page, `coworkers-list-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });

    await check(`${tag}: with a conversation the chat view opens under the coworker's header, at the coworker's address`, async () => {
      const { page } = await setup(browser, origin, view, { specialists: (s, spaces) => s.add({ name: 'QA Talker', glyph: '✍️', tint: 'success', spaces: [spaces[0].id], defaultSpace: spaces[0].id, projectId: 'specialist-qa-1', chatId: 'chat-qa-1' }), route: (c) => `/coworkers/${c.id}` });
      try {
        await page.getByRole('heading', { name: 'QA Talker', level: 1 }).waitFor({ timeout: 15000 });
        await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 15000 });
        assert.equal(await page.getByText("This chat isn't available").count(), 0, 'a coworker conversation is in no chat list and is never "not found"');
        assert.equal(await page.getByText('The conversation is not ready yet').count(), 0);
        assert.match(new URL(page.url()).pathname, /^\/coworkers\/c0c0c0c0-/, 'the address stays the coworker\'s');
        await page.getByText('Can write to 1 Space · Default: QA-2446 Research').waitFor();
        const above = await page.evaluate(() => { const h = document.querySelector('.cw-header'); const c = document.querySelector('textarea'); return !!h && !!c && h.getBoundingClientRect().bottom <= c.getBoundingClientRect().top; });
        assert.equal(above, true, 'the header sits above the conversation');
        await shot(page, `coworker-conversation-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });

    await check(`${tag}: allowed tools: listed from the tool groups and saved when the server keeps them`, async () => {
      const { page, sp } = await setup(browser, origin, view, { tools: true, specialists: (s) => s.add({ toolboxes: ['qa-files'] }), route: (c) => `/coworkers/${c.id}` });
      try {
        await page.getByRole('heading', { name: 'QA Researcher', level: 1 }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'Settings for QA Researcher' }).click();
        const dlg = sheet(page, 'Coworker settings');
        await dlg.getByRole('checkbox', { name: /QA web/ }).waitFor({ timeout: 8000 });
        assert.equal(await dlg.getByRole('checkbox', { name: /QA files/ }).isChecked(), true);
        await dlg.getByRole('checkbox', { name: /QA web/ }).check();
        await page.waitForTimeout(300);
        await shot(page, `coworker-tools-${view[0]}-${view[2]}`);
        await dlg.getByRole('button', { name: 'Save' }).click();
        await dlg.waitFor({ state: 'detached', timeout: 8000 });
        assert.deepEqual(patches(sp)[0].body.toolboxes, ['qa-files', 'qa-web']);
      } finally { await page.close(); }
    });
  }

  for (const view of VIEWS.filter((v) => v[2] === 'light' || v[0] === 768)) {
    const tag = `${view[0]} px ${view[2]}`;
    for (const capability of ['absent', 'broken']) {
      await check(`${tag}: ${capability}: no Coworkers entry, and the paths read as an unknown page`, async () => {
        const { page } = await setup(browser, origin, view, { capability, route: '/coworkers' });
        try {
          await page.getByText("This page isn't here").waitFor({ timeout: 10000 });
          await openNav(page);
          assert.equal(await page.getByRole('button', { name: 'Coworkers', exact: true }).count(), 0);
          assert.equal(new URL(page.url()).pathname, '/coworkers');
          await shot(page, `coworkers-hidden-${capability}-${view[0]}-${view[2]}`);
        } finally { await page.close(); }
      });
    }
    await check(`${tag}: with the routes the entry is there`, async () => {
      const { page } = await setup(browser, origin, view, { route: '/' });
      try {
        await openNav(page);
        const entry = page.getByRole('button', { name: 'Coworkers', exact: true });
        await entry.waitFor({ timeout: 10000 });
        await entry.click();
        await page.getByRole('heading', { name: 'Coworkers', level: 1 }).waitFor();
      } finally { await page.close(); }
    });
  }
});
