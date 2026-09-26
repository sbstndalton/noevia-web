// #439: sidebar search keyboard navigation (ArrowDown/ArrowUp/Enter, Escape-back-to-field) and
// match highlighting. #440: right-click on a nested (in-project) chat row opens the same
// context menu as a top-level row, including the archive+undo path (#432).
//
// Offline, synthetic fixture (createFixture, diary-fixture.cjs) answers every /api call — no
// inference, storage, Diary or network — with page.route overriding /api/workspace and
// /api/freechats//api/chats/*/history the way sidebar-focus-undo.cjs already does.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-shots';

const activeElement = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return {
    tag: el?.tagName ?? null,
    text: el?.textContent?.trim() ?? null,
    isBody: el === document.body,
  };
});

(async () => {
  const fixture = createFixture(31563);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  let passed = 0;
  const pass = (msg) => { passed += 1; console.log(`PASS sidebar-search-nested-menu: ${msg}`); };
  try {
    const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const chat = (id, title, updatedAt, extra = {}) => ({ id, title, updatedAt, archived: false, pinned: false, messages: [], ...extra });
    let freeChats = [
      chat('chat-audit-1', 'Audit the Q3 numbers', 5000),
      chat('chat-audit-2', 'Team audit summary', 4000),
      chat('chat-plain', 'Grocery list', 3000),
      // A title holding regex-special characters: highlighting a query built straight from this
      // text (or matching it) must never throw and must never treat "." as "any character".
      chat('chat-formula', 'Formula a.b(c) check', 2000),
    ];
    const projects = [{
      id: 'p1',
      name: 'Project X',
      pinned: false,
      chats: [
        chat('nested-a', 'Nested chat A', 1000),
        chat('nested-b', 'Nested chat B', 900),
      ],
    }];
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
    // A nested chat's archive/undo (#440) saves through the project's own chat-list endpoint,
    // not /api/freechats — mirror handlePatchChat's real save path (App.tsx: saveProjectChats).
    await page.route('**/api/projects/p1/chats', async (r) => {
      if (r.request().method() === 'POST') {
        const body = r.request().postDataJSON();
        patches.push(body);
        projects[0].chats = body.chats;
        return r.fulfill({ json: { ok: true } });
      }
      return r.continue();
    });
    // A chat opened by Enter lazily loads its history (App.tsx); nothing real to load here.
    await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [] } }));

    await page.goto('http://localhost:31563');
    await page.getByPlaceholder('Message noevia…').waitFor();

    // ── #439(a): type a query, ArrowDown enters the results, Down/Up move, Enter opens ──
    await page.getByRole('button', { name: 'Search projects and chats', exact: true }).first().click();
    const search = page.getByPlaceholder('Search projects and chats…');
    await search.waitFor();
    await search.fill('audit');
    await page.waitForTimeout(30);

    const beforeArrow = await activeElement(page);
    assert.equal(beforeArrow.tag, 'INPUT', 'before any arrow key, focus is still the search field');

    await page.keyboard.press('ArrowDown');
    const first = await activeElement(page);
    assert.equal(first.tag, 'BUTTON', 'ArrowDown from the field moves focus onto the first result');
    assert.match(first.text || '', /Audit the Q3 numbers/, `ArrowDown must land on the first (most recent) match, saw ${JSON.stringify(first)}`);
    pass('ArrowDown from the search field moves focus to the first result');

    await page.keyboard.press('ArrowDown');
    const second = await activeElement(page);
    assert.match(second.text || '', /Team audit summary/, `ArrowDown again must move to the second match, saw ${JSON.stringify(second)}`);
    pass('ArrowDown again moves to the next result');

    await page.keyboard.press('ArrowUp');
    const backToFirst = await activeElement(page);
    assert.match(backToFirst.text || '', /Audit the Q3 numbers/, `ArrowUp must move back to the first match, saw ${JSON.stringify(backToFirst)}`);
    pass('ArrowUp moves back to the previous result');

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname.includes('chat-audit-1'), null, { timeout: 2000 });
    assert.match(page.url(), /\/c\/chat-audit-1/, `Enter must open the active result (the URL changes): ${page.url()}`);
    pass('Enter opens the active result and the URL changes');

    // ── #439: Escape from a focused result returns to the field; a second Escape closes search
    // (the pre-existing #355 behaviour) ──
    await search.fill('audit');
    await page.waitForTimeout(30);
    await page.keyboard.press('ArrowDown');
    assert.equal((await activeElement(page)).tag, 'BUTTON');
    await page.keyboard.press('Escape');
    const backOnField = await activeElement(page);
    assert.equal(backOnField.tag, 'INPUT', 'a first Escape from a result returns focus to the search field');
    assert.equal(await search.inputValue(), 'audit', 'a first Escape from a result does not also clear the query');
    await page.keyboard.press('Escape');
    await search.waitFor({ state: 'hidden' }).catch(() => undefined);
    assert.equal(await page.locator('.shell-search').count(), 0, 'a second Escape (already on the field) closes search — the existing #355 behaviour');
    pass('Escape from a result returns to the field; a second Escape keeps the existing close behaviour');

    // ── #439(b): matched text is wrapped in <mark>, case-insensitively, and a query full of
    // regex metacharacters never throws ──
    await page.getByRole('button', { name: 'Search projects and chats', exact: true }).first().click();
    await search.waitFor();
    await search.fill('AUDIT');
    await page.waitForTimeout(30);
    const marks = await page.locator('mark.sidebar-search-highlight').allTextContents();
    assert.ok(marks.length >= 2, `at least the two audit chats should have a <mark>: ${JSON.stringify(marks)}`);
    // The source text's own casing is preserved — only the *query* was uppercase.
    assert.ok(marks.every((m) => m.toLowerCase() === 'audit'), `every mark must be the matched text itself: ${JSON.stringify(marks)}`);
    pass('the matched substring is wrapped in <mark>, case-insensitively');

    // Scoped to .sidebar: ChatView also renders its own (unrelated, #437 drop-hint) sr-only
    // polite status span in .chat-workspace, so the bare selector matches two elements once
    // #441's merge is in (merge conflict adjacent-collision, not a text conflict).
    const resultCount = page.locator('.sidebar [role="status"][aria-live="polite"].sr-only');
    await resultCount.waitFor();
    assert.match((await resultCount.textContent()) || '', /result/, 'the live region announces a result count');
    pass('a polite live region announces the result count');

    assert.deepEqual(errors, [], 'no page error yet');
    await search.fill('a.b(');
    await page.waitForTimeout(30);
    assert.deepEqual(errors, [], 'a query full of regex metacharacters must never throw');
    const formulaMarks = await page.locator('mark.sidebar-search-highlight').allTextContents();
    assert.ok(formulaMarks.includes('a.b('), `"a.b(" must highlight literally: ${JSON.stringify(formulaMarks)}`);
    // Sanity: nothing next to "a.b(" in the source (the "c" inside the parens) got swept into
    // the match the way an unescaped "." or "(" in a real regex would.
    assert.ok(!formulaMarks.some((m) => m.includes('c)')), `the highlight must not run past the literal query: ${JSON.stringify(formulaMarks)}`);
    pass('a query built from regex-special characters ("a.b(") highlights literally and never throws');

    await search.fill('');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.shell-search').waitFor({ state: 'detached' }).catch(() => undefined);

    // ── #440(c): a nested chat row's right-click menu has the same items as a top-level row,
    // and Archive from it goes through the same archive+undo path ──
    const topRow = page.locator('.chat-row', { hasText: 'Grocery list' });
    await topRow.click({ button: 'right' });
    const topMenu = page.locator('.ctx-menu[role="menu"]');
    await topMenu.waitFor();
    const topItems = await topMenu.getByRole('menuitem').allTextContents();
    await page.keyboard.press('Escape');
    await topMenu.waitFor({ state: 'detached' });
    assert.ok(topItems.length > 0, 'the top-level row menu has items to compare against');

    await page.getByRole('button', { name: 'Expand chats in Project X' }).click();
    const nestedRow = page.locator('.project-children .chat-row', { hasText: 'Nested chat A' });
    await nestedRow.waitFor();
    // Baseline for #440: before the fix, right-click opened nothing at all.
    await nestedRow.click({ button: 'right' });
    const nestedMenu = page.locator('.ctx-menu[role="menu"]');
    await nestedMenu.waitFor({ timeout: 2000 });
    const nestedItems = await nestedMenu.getByRole('menuitem').allTextContents();
    assert.deepEqual(nestedItems, topItems, `the nested row's context menu must offer the same items as a top-level row: ${JSON.stringify({ nestedItems, topItems })}`);
    pass('right-click on a nested chat row opens the same context menu items as a top-level row');

    await nestedMenu.getByRole('menuitem', { name: 'Archive', exact: true }).click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.project-children .chat-row', { hasText: 'Nested chat A' }).count(), 0, 'Archive from the nested row menu removes it from the project\'s chat list');
    const toast = page.locator('.save-error.is-notice[role="status"]');
    await toast.waitFor();
    await toast.getByText('archived').waitFor().catch(() => undefined);
    const undo = toast.getByRole('button', { name: 'Undo', exact: true });
    await undo.waitFor();
    pass('Archive from the nested row\'s context menu shows the undo toast (#432\'s archive+undo path)');

    await undo.click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.project-children .chat-row', { hasText: 'Nested chat A' }).count(), 1, 'Undo restores the nested chat to the project\'s chat list');
    const lastPatch = patches.at(-1);
    assert.ok(lastPatch, 'Undo saved something');
    pass('Undo from the nested row\'s archive toast restores the chat');

    await page.screenshot({ path: `${out}/sidebar-search-nested-menu-1440.png` });
    assert.deepEqual(errors, [], 'no page errors for the whole run');
    console.log(`PASS sidebar-search-nested-menu: all ${passed} scenarios.`);
    await page.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
