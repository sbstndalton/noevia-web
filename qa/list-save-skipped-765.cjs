// Synthetic browser regression for #765; no live account, Diary, or model.
// A stale tab still shows a chat in the free list after another tab moved it into a project. Pinning
// it there posts the whole free list; the server's move dedupe drops the chat and reports it as
// skipped. The tab must then refresh and show the chat where it really is (in the project, not
// pinned), instead of believing the pin landed.
//
//   npm run build -- --outDir /path/outside/sync
//   QA_DIST=/path/outside/sync PLAYWRIGHT_MODULE=/path/to/playwright [CHROME_EXECUTABLE=/path/to/chromium] \
//     node qa/list-save-skipped-765.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const port = 31765;
const chat = (id, title, updatedAt = 1000) => ({ id, title, preview: 'Synthetic preview', updatedAt, pinned: false, archived: false });
const project = (chats) => ({ id: 'p-moved', name: 'Synthetic destination', updatedAt: 1000, files: [], chats });

(async () => {
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: process.env.QA_CHANNEL || 'chrome' }) });
  const errors = [];
  try {
    const moved = chat('c-moved', 'Synthetic moved chat', 2000), other = chat('c-other', 'Synthetic staying chat');
    // What this stale tab loaded first, and what the server holds now (another tab moved the chat).
    const stale = { projects: [project([])], freeChats: [moved, other] };
    const server = { projects: [project([moved])], freeChats: [other] };
    let gets = 0; const posts = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 760 }, reducedMotion: 'reduce' });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/workspace', (route) => route.fulfill({ json: ++gets === 1 ? stale : server }));
    await page.route('**/api/freechats', (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: { chats: server.freeChats } });
      const chats = route.request().postDataJSON().chats;
      posts.push(chats);
      const projectIds = new Set(server.projects.flatMap((p) => p.chats.map((c) => c.id)));
      const skipped = chats.filter((c) => projectIds.has(c.id)).map((c) => c.id);
      const byId = new Map(server.freeChats.map((c) => [c.id, c]));
      for (const c of chats) if (!projectIds.has(c.id)) byId.set(c.id, { ...byId.get(c.id), ...c });
      server.freeChats = [...byId.values()];
      return route.fulfill({ json: skipped.length ? { ok: true, skipped } : { ok: true } });
    });
    await page.goto(`http://localhost:${port}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    const row = (title) => page.locator('.chat-row').filter({ hasText: title });
    await row(moved.title).first().waitFor();

    await row(moved.title).last().click({ button: 'right' });
    await page.getByRole('menu').waitFor();
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
    for (let i = 0; i < 80 && !posts.length; i++) await page.waitForTimeout(25);
    assert.equal(posts.length, 1, 'the stale tab posted its free list');
    assert.ok(posts[0].some((c) => c.id === moved.id && c.pinned === true), 'the pin was in the stale post');

    // The tab refreshes and shows the server's lists: the chat sits in the project, not pinned.
    for (let i = 0; i < 80 && gets < 2; i++) await page.waitForTimeout(25);
    assert.ok(gets >= 2, 'a skipped save refreshes the workspace lists');
    await page.locator('.chat-row button[aria-pressed=true]').waitFor({ state: 'detached', timeout: 3000 });
    assert.equal(await page.locator('.chat-row button[aria-pressed=true]').count(), 0, 'no pin is shown for a chat that did not save here');
    assert.equal(await row(other.title).count(), 1, 'the free chat that stayed is still listed');
    assert.equal(server.freeChats.some((c) => c.id === moved.id), false, 'the server never took the moved chat back');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('list-save-skipped-765: PASS');
  } catch (error) {
    console.error('list-save-skipped-765: FAIL', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await fixture.close?.();
    process.exit(process.exitCode || 0);
  }
})();
