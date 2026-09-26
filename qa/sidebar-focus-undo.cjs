// #355 (reopened) / #362 (reopened): real-browser regressions the earlier PRs' source-text-only
// tests missed. Offline: a synthetic in-memory fixture (createFixture, diary-fixture.cjs) answers
// every /api call — no inference, storage, Diary or network. Covers:
//   - sidebar search Escape returns focus to the search trigger, not <body>
//   - inline chat rename Escape (cancel) and Enter (commit) both return focus to the row's
//     Options button, not <body> — the row's own row-actions are display:none (phone.css,
//     @media(hover:hover)) except on :hover/:focus-within, which is what dropped focus before
//   - quick-archive's toast Undo actually restores the chat: the API body carries archived:false
//     and the chat reappears in the sidebar's own (re-rendered) recent-chats list
//   - the same Undo also reaches an already-mounted, independent workspace reader (Settings ->
//     Your data & privacy's archived-chat count), which onPatchChat alone does not refresh
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const activeElement = (page) => page.evaluate(() => ({
  tag: document.activeElement?.tagName ?? null,
  label: document.activeElement?.getAttribute('aria-label') ?? null,
  isBody: document.activeElement === document.body,
}));

(async () => {
  const fixture = createFixture(31462);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS sidebar-focus-undo: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const chat = (id, extra = {}) => ({ id, title: `Synthetic ${id}`, updatedAt: 1000, archived: false, messages: [], ...extra });
    let freeChats = [chat('a'), chat('b'), chat('c')];
    const patches = [];
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
    await page.route('**/api/freechats', async (r) => {
      if (r.request().method() === 'POST') {
        const body = r.request().postDataJSON();
        patches.push(body);
        freeChats = body.chats;
        return r.fulfill({ json: { ok: true } });
      }
      return r.continue();
    });

    await page.goto('http://localhost:31462');
    await page.getByPlaceholder('Message noevia…').waitFor();

    // ── #355: sidebar search Escape returns focus to the trigger that opened it ──
    await page.getByRole('button', { name: 'Search projects and chats', exact: true }).first().click();
    const search = page.getByPlaceholder('Search projects and chats…');
    await search.waitFor();
    await search.fill('Synthetic a');
    await page.keyboard.press('Escape');
    const afterSearch = await activeElement(page);
    assert.equal(afterSearch.isBody, false, 'search Escape must not drop focus to <body>');
    assert.equal(afterSearch.tag, 'BUTTON');
    assert.equal(afterSearch.label, 'Search projects and chats');
    pass('sidebar search Escape returns focus to the search trigger button');

    // ── #355: inline rename Escape returns focus to the row's Options button ──
    const row = page.locator('.chat-row', { hasText: 'Synthetic a' });
    await row.hover();
    await row.getByRole('button', { name: /Options for/ }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const renameInput = page.locator('.proj-rename-input');
    await renameInput.waitFor();
    assert.equal((await activeElement(page)).tag, 'INPUT', 'the rename input takes focus when it opens');
    await page.keyboard.press('Escape');
    // The focus restore is deferred to the next animation frame (Sidebar.tsx's
    // returnFocusToRow), so give it a turn of the event loop before asserting.
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 2000 }).catch(() => undefined);
    const afterEscape = await activeElement(page);
    assert.equal(afterEscape.isBody, false, 'rename Escape must not drop focus to <body>');
    assert.equal(afterEscape.tag, 'BUTTON');
    assert.equal(afterEscape.label, 'Options for Synthetic a');
    pass('inline rename Escape returns focus to the row\'s Options button, not <body>');

    // ── #355: inline rename Enter (commit, unchanged text) also returns focus ──
    await row.hover();
    await row.getByRole('button', { name: /Options for/ }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await renameInput.waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 2000 }).catch(() => undefined);
    const afterEnter = await activeElement(page);
    assert.equal(afterEnter.isBody, false, 'rename Enter must not drop focus to <body>');
    assert.equal(afterEnter.tag, 'BUTTON');
    assert.equal(afterEnter.label, 'Options for Synthetic a');
    pass('inline rename Enter returns focus to the row\'s Options button, not <body>');

    // ── #362: open Settings -> Your data & privacy first. Settings is an overlay (a sibling of
    // .app-stack, not inside it) so the Sidebar stays mounted and interactive underneath it —
    // this is how a tester can watch a second, independently-fetched workspace reader while
    // using the sidebar's own quick-archive + Undo. ──
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.locator('.account-popover').getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('region', { name: 'Settings' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Your data & privacy', exact: true }).click();
    const archivedCount = dialog.locator('.set-row-label', { hasText: /archived chat/ });
    await archivedCount.waitFor();
    assert.equal((await archivedCount.innerText()).trim(), '0 archived chats');

    // ── #362: quick-archive, then the toast's Undo must actually restore the chat ──
    await row.hover();
    await row.getByRole('button', { name: /Archive/ }).click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic a' }).count(), 0, 'archiving removes the row from the sidebar list');
    assert.equal((await archivedCount.innerText()).trim(), '1 archived chat', 'a second, already-open workspace reader also learns about the archive');
    const toast = page.locator('.save-error.is-notice');
    await toast.waitFor();
    await toast.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForTimeout(50);

    const lastPatch = patches.at(-1);
    const patchedChat = lastPatch?.chats?.find((c) => c.id === 'a');
    assert.ok(patchedChat, 'Undo sends a save that includes the archived chat');
    assert.equal(patchedChat.archived, false, 'Undo\'s save body carries archived:false for the chat');
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic a' }).count(), 1, 'Undo actually re-renders the chat back into the sidebar list');
    assert.equal((await archivedCount.innerText()).trim(), '0 archived chats', 'Undo also reaches the already-open Settings count, not just this component\'s own state');
    pass('quick-archive Undo sends archived:false and restores the chat to the sidebar list and to another already-mounted workspace reader');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS sidebar-focus-undo: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
