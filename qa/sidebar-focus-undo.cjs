// #355 (reopened) / #362 (reopened, twice) / #418: real-browser regressions the earlier PRs'
// source-text-only tests missed. Offline: a synthetic in-memory fixture (createFixture,
// diary-fixture.cjs) answers every /api call — no inference, storage, Diary or network. Covers:
//   - #418: the ordinary forward Tab walk through a pinned chat row and a project row reaches
//     every row-action button (Pin/Unpin, Archive, Options; a project's Options/New chat), never
//     dropping to <body> for a stop — `.row-actions` was `display:none` outside hover/focus-within
//     (phone.css, unconditionally under (hover:hover), i.e. every real desktop browser, not just
//     small viewports as the surrounding comment implied), which removes an element from the
//     page's native focus order entirely
//   - sidebar search Escape returns focus to the search trigger, not <body>
//   - inline chat rename Escape (cancel) and Enter (commit) both return focus to the row's
//     Options button, not <body> — programmatically focusing into a then-`display:none`
//     row-actions container silently no-ops, which is what dropped focus before
//   - #355 (reopened a third time): inline PROJECT rename Escape and Enter also return focus to
//     the project row's own Options button, not <body>, checked at 0ms and again at 500ms so a
//     fix that only "eventually" recovers focus (or never does) cannot pass by accident
//   - quick-archive's toast Undo actually restores the chat: the API body carries archived:false
//     and the chat reappears in the sidebar's own (re-rendered) recent-chats list
//   - the same Undo also reaches an already-mounted, independent workspace reader (Settings ->
//     Your data & privacy's archived-chat count), which onPatchChat alone does not refresh
//   - #362 (reopened again): a keyboard-initiated quick-archive puts focus directly on the
//     toast's Undo button (it used to rely on the ordinary Tab order, which the archived row's
//     own removal from the DOM broke the same way #418 did), and Undo restores the chat when
//     activated by a real Enter keypress, not just a click
//   - #362 (reopened a fourth time): the row's own "…" menu Archive item goes through the same
//     archive+undo path as the hover quick-archive icon, both at 1440px and at 500px (≤700px,
//     where the quick-archive icon itself is hidden and the "…" menu is the only reachable way
//     to archive a chat) — not just a plain onPatchChat with no toast and no way back
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
    // A pinned chat and a pinned project (both empty of their own chats) so #418's Tab walk has
    // a pinned-row and a project-row to cross, matching the two markups the issue named.
    let freeChats = [chat('a', { pinned: true }), chat('b'), chat('c')];
    const projects = [{ id: 'p1', name: 'Project X', pinned: true, chats: [] }];
    const patches = [];
    await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects, freeChats } }));
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

    // ── #418: Tab through the pinned chat row and the project row reaches every row-action
    // button, never <body> ──
    await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
    const tabbed = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const state = await activeElement(page);
      // Captured in the same step as the Tab that landed here, while this element still holds
      // focus — a stale re-query after focus has moved on would see the reveal-on-focus CSS
      // already reverted, and wrongly look zero-size regardless of this fix.
      const rect = await page.evaluate(() => { const r = document.activeElement?.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; });
      tabbed.push({ ...state, rect });
    }
    assert.equal(tabbed.filter((s) => s.isBody).length, 0, `Tab must never land on <body>: ${JSON.stringify(tabbed)}`);
    const byLabel = new Map(tabbed.map((s) => [s.label, s]));
    for (const expected of ['Unpin Synthetic a', 'Archive Synthetic a', 'Options for Synthetic a', 'Options for Project X', 'New chat in Project X']) {
      const s = byLabel.get(expected);
      assert.ok(s, `Tab walk must reach "${expected}": saw ${JSON.stringify(tabbed.map((t) => t.label))}`);
      // Also a real, visible target once focused (not a zero-size element that merely happens to
      // be in the DOM) — the :focus-within reveal actually ran.
      assert.ok(s.rect && s.rect.width > 0 && s.rect.height > 0, `"${expected}" must have a real, nonzero box once focused`);
    }
    pass('Tab through a pinned chat row and a project row reaches every row-action button, never <body>, each with a real visible box');

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

    // ── #355 (reopened a third time): inline PROJECT rename Escape returns focus to the
    // project row's own Options button, not <body> — checked immediately and again at 500ms. ──
    const projRow = page.locator('.proj-row', { hasText: 'Project X' });
    const projRenameInput = page.locator('.proj-rename-input');
    await projRow.hover();
    await projRow.getByRole('button', { name: 'Options for Project X', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await projRenameInput.waitFor();
    assert.equal((await activeElement(page)).tag, 'INPUT', 'the project rename input takes focus when it opens');
    await page.keyboard.press('Escape');
    // The focus restore is deferred to the next animation frame (returnFocusToRow), so a check
    // truly at 0ms — before the browser has painted that frame at all — would fail even for a
    // correct fix; bound the wait to one frame's worth of slack, not the multi-second recovery
    // the live bug never gave (0s/0.5s/2.5s were all <body> there).
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 200 }).catch(() => undefined);
    const immediateProjEscape = await activeElement(page);
    assert.equal(immediateProjEscape.isBody, false, 'project rename Escape must not drop focus to <body> at 0ms');
    assert.equal(immediateProjEscape.label, 'Options for Project X', 'project rename Escape at 0ms must land on the row\'s Options button');
    await page.waitForTimeout(500);
    const afterProjEscape = await activeElement(page);
    assert.equal(afterProjEscape.isBody, false, 'project rename Escape must not drop focus to <body> at 500ms');
    assert.equal(afterProjEscape.tag, 'BUTTON');
    assert.equal(afterProjEscape.label, 'Options for Project X');
    pass('project-row rename Escape returns focus to the row\'s Options button at 0ms and 500ms, not <body>');

    // ── #355 (reopened a third time): same for Enter (commit, unchanged text) ──
    await projRow.hover();
    await projRow.getByRole('button', { name: 'Options for Project X', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await projRenameInput.waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 200 }).catch(() => undefined);
    const immediateProjEnter = await activeElement(page);
    assert.equal(immediateProjEnter.isBody, false, 'project rename Enter must not drop focus to <body> at 0ms');
    assert.equal(immediateProjEnter.label, 'Options for Project X', 'project rename Enter at 0ms must land on the row\'s Options button');
    await page.waitForTimeout(500);
    const afterProjEnter = await activeElement(page);
    assert.equal(afterProjEnter.isBody, false, 'project rename Enter must not drop focus to <body> at 500ms');
    assert.equal(afterProjEnter.tag, 'BUTTON');
    assert.equal(afterProjEnter.label, 'Options for Project X');
    pass('project-row rename Enter returns focus to the row\'s Options button at 0ms and 500ms, not <body>');

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

    // ── #362 (reopened again): a keyboard-initiated quick-archive must put focus directly on
    // the toast's Undo button — the archived row (and thus focus, for a keyboard activation) is
    // removed from the DOM in the same instant, so relying on the ordinary Tab order to find a
    // toast that renders near the sidebar's footer left a keyboard user with no realistic path to
    // it before the 6s auto-dismiss. A real Enter keypress (not .click()) on the row's own
    // Archive button is what a keyboard user actually does; Chrome reports that click's
    // event.detail as 0, which is what the fix keys off. ──
    const rowB = page.locator('.chat-row', { hasText: 'Synthetic b' });
    await rowB.hover();
    await rowB.getByRole('button', { name: /Archive/ }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic b' }).count(), 0, 'archiving removes the row from the sidebar list');
    const afterKeyboardArchive = await activeElement(page);
    assert.equal(afterKeyboardArchive.isBody, false, 'a keyboard-initiated archive must not drop focus to <body>');
    const activeText = await page.evaluate(() => document.activeElement?.textContent ?? null);
    assert.equal(activeText, 'Undo', 'focus must land directly on the toast\'s Undo button');
    // Still reachable well inside the 6s window: activate it the same way a keyboard user would.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    const lastKeyboardPatch = patches.at(-1);
    const restoredB = lastKeyboardPatch?.chats?.find((c) => c.id === 'b');
    assert.ok(restoredB, 'keyboard-activated Undo sends a save that includes the archived chat');
    assert.equal(restoredB.archived, false, 'keyboard-activated Undo\'s save body carries archived:false');
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic b' }).count(), 1, 'keyboard-activated Undo restores the chat to the sidebar list');
    pass('a keyboard-initiated quick-archive puts focus on the toast\'s Undo button, not <body>, and Enter on it restores the chat');

    // ── #362 (reopened a fourth time): the row's own "…" menu Archive item, at 1440px, goes
    // through the same archive+undo path as the hover quick-archive icon (the toast appears and
    // Undo restores the chat) — not a plain onPatchChat with no way back. ──
    const rowC = page.locator('.chat-row', { hasText: 'Synthetic c' });
    await rowC.hover();
    await rowC.getByRole('button', { name: /Options for/ }).click();
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic c' }).count(), 0, 'row-menu Archive removes the row from the sidebar list at 1440px');
    const toastWide = page.locator('.save-error.is-notice[role="status"]');
    await toastWide.waitFor();
    await toastWide.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic c' }).count(), 1, 'row-menu Archive\'s Undo restores the chat at 1440px');
    pass('row menu Archive at 1440px goes through the same undo-toast path as the hover quick-archive icon, and Undo restores the chat');

    // ── #362 (reopened a fourth time): at ≤700px the hover quick-archive icon is hidden and the
    // "…" menu is the only reachable way to archive — it must still go through the undo toast.
    // Settings (opened above) covers the whole view below 520px, hiding the drawer toggle
    // entirely — close it first, the same way a real narrow-viewport user would. ──
    await page.keyboard.press('Escape');
    await page.getByRole('region', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 2000 }).catch(() => undefined);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    const rowANarrow = page.locator('.chat-row', { hasText: 'Synthetic a' });
    // The row's own action buttons are still hover/focus-within-revealed even under the narrow
    // breakpoint (only the *quick* pin/archive icons are additionally collapsed down to just
    // Options there) — this headless browser still has real hover capability, unlike an actual
    // touch device, so the same reveal step as the 1440px case applies.
    await rowANarrow.hover();
    await rowANarrow.getByRole('button', { name: /Options for/ }).click();
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic a' }).count(), 0, 'row-menu Archive removes the row from the sidebar list at 500px');
    const toastNarrow = page.locator('.save-error.is-notice[role="status"]');
    await toastNarrow.waitFor();
    await toastNarrow.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.chat-row', { hasText: 'Synthetic a' }).count(), 1, 'row-menu Archive\'s Undo restores the chat at 500px');
    pass('row menu Archive at 500px (≤700px, the only reachable archive path there) goes through the undo-toast path, and Undo restores the chat');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS sidebar-focus-undo: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
