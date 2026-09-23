// Synthetic browser regression; no live account, Diary, or model.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const port = 31562;
const chat = (id, title) => ({ id, title, preview: 'Original preview', updatedAt: 1000, pinned: false, archived: false });
const project = (chats = []) => ({ id: 'p1', name: 'Synthetic project', updatedAt: 1000, files: [], chats });
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

(async () => {
  const fixture = createFixture(port); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [];
  const openMenu = async (page, title) => {
    await page.locator('.chat-row').filter({ hasText: title }).last().click({ button: 'right' });
    await page.getByRole('menu').waitFor();
  };
  const makePage = async (routes, width = 1440, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width, height: 760 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(t => localStorage.setItem('cowork-theme', t), theme);
    await routes(page);
    await page.goto(`http://localhost:${port}`);
    await page.getByPlaceholder('Message noevia…').waitFor();
    if (width < 520) await page.getByRole('button', { name: 'Open navigation' }).click();
    return page;
  };
  try {
    for (const source of ['free', 'project']) {
      const original = chat(`${source}-one`, `Synthetic ${source} chat`);
      let workspaceGets = 0, posts = 0;
      const page = await makePage(async page => {
        await page.route('**/api/workspace', route => {
          workspaceGets++;
          return workspaceGets === 1
            ? route.fulfill({ json: { projects: [project(source === 'project' ? [original] : [])], freeChats: source === 'free' ? [original] : [] } })
            : route.fulfill({ status: 503, json: { error: 'synthetic offline workspace' } });
        });
        await page.route(source === 'free' ? '**/api/freechats' : '**/api/projects/p1/chats', route => {
          posts++; return route.fulfill({ status: 500, json: { error: 'synthetic save failure' } });
        });
      });
      await openMenu(page, original.title);
      await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      await page.getByRole('alert').getByText(/synthetic save failure/).waitFor();
      assert.equal(await page.locator('.chat-row').filter({ hasText: original.title }).last().locator('button[aria-pressed=true]').count(), 0);
      await page.evaluate(() => window.dispatchEvent(new Event('noevia:workspace-changed')));
      await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
      await openMenu(page, original.title);
      await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
      const input = page.locator('.proj-rename-input'); await input.waitFor();
      await input.fill('Unsaved title'); await input.press('Enter');
      await page.getByRole('alert').getByText(/synthetic save failure/).waitFor();
      assert.equal(await page.locator('.chat-row').filter({ hasText: 'Unsaved title' }).count(), 0);
      await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();
      await openMenu(page, original.title);
      await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
      await page.getByRole('alert').getByText(/synthetic save failure/).waitFor();
      assert.ok(await page.locator('.chat-row').filter({ hasText: original.title }).count() > 0);
      assert.equal(posts, 3);
      assert.ok(workspaceGets >= 2);
      await page.close();
    }

    // Delayed first save, a second queued action, and newer unrelated fields.
    {
      const first = deferred(), second = deferred();
      const initial = chat('queued-one', 'Queued chat'), sibling = chat('other', 'Other chat');
      let workspace = { projects: [project()], freeChats: [initial, sibling] };
      const sent = [];
      const page = await makePage(async page => {
        await page.route('**/api/workspace', route => route.fulfill({ json: workspace }));
        await page.route('**/api/freechats', async route => {
          sent.push(route.request().postDataJSON().chats);
          if (sent.length === 1) { await first.promise; return route.fulfill({ json: { ok: true } }); }
          await second.promise; return route.fulfill({ json: { ok: true } });
        });
      });
      await openMenu(page, 'Queued chat'); await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      for (let i = 0; i < 40 && sent.length < 1; i++) await page.waitForTimeout(25);
      assert.equal(sent.length, 1);
      await openMenu(page, 'Queued chat'); await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
      assert.equal(sent.length, 1, 'second save started before first settled');
      workspace = { projects: [project()], freeChats: [{ ...initial, title: 'Newer title', preview: 'Newer preview', updatedAt: 2000 }, sibling] };
      await page.evaluate(() => window.dispatchEvent(new Event('noevia:workspace-changed')));
      await page.locator('.chat-row').filter({ hasText: 'Newer title' }).last().waitFor();
      first.release();
      for (let i = 0; i < 40 && sent.length < 2; i++) await page.waitForTimeout(25);
      assert.equal(sent.length, 2);
      const target = sent[1].find(c => c.id === 'queued-one');
      assert.deepEqual({ pinned: target.pinned, archived: target.archived, title: target.title, preview: target.preview, updatedAt: target.updatedAt },
        { pinned: true, archived: true, title: 'Newer title', preview: 'Newer preview', updatedAt: 2000 });
      assert.deepEqual(sent[1].find(c => c.id === 'other'), sibling);
      second.release();
      await page.locator('.chat-row').filter({ hasText: 'Newer title' }).last().waitFor({ state: 'hidden' });
      await page.close();
    }

    // A workspace GET started before a successful save must not undo it.
    {
      const oldGet = deferred(); let gets = 0, getStarted = false;
      const initial = chat('stale-one', 'Stale chat');
      const page = await makePage(async page => {
        await page.route('**/api/workspace', async route => {
          if (++gets === 1) return route.fulfill({ json: { projects: [], freeChats: [initial] } });
          getStarted = true; await oldGet.promise;
          return route.fulfill({ json: { projects: [], freeChats: [initial] } });
        });
        await page.route('**/api/freechats', route => route.fulfill({ json: { ok: true } }));
      });
      await page.evaluate(() => window.dispatchEvent(new Event('noevia:workspace-changed')));
      for (let i = 0; i < 40 && !getStarted; i++) await page.waitForTimeout(25);
      assert.ok(getStarted);
      await openMenu(page, 'Stale chat'); await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      const pinned = page.locator('.chat-row').filter({ hasText: 'Stale chat' }).last().locator('button[aria-pressed=true]');
      await pinned.waitFor({ state: 'attached' }); oldGet.release(); await page.waitForTimeout(100);
      assert.equal(await pinned.count(), 1);
      await page.close();
    }

    // A rejected first action does not leak into the next list payload, and
    // a pending free-chat request does not hold up a project-chat save.
    {
      const first = deferred(), free = chat('fail-one', 'Fail then archive');
      const nested = chat('project-one', 'Independent project chat');
      const freePayloads = [];
      const page = await makePage(async page => {
        await page.route('**/api/workspace', route => route.fulfill({ json: { projects: [project([nested])], freeChats: [free] } }));
        await page.route('**/api/freechats', async route => {
          freePayloads.push(route.request().postDataJSON().chats);
          if (freePayloads.length === 1) { await first.promise; return route.fulfill({ status: 500, json: { error: 'synthetic first failure' } }); }
          return route.fulfill({ json: { ok: true } });
        });
        await page.route('**/api/projects/p1/chats', route => route.fulfill({ json: { ok: true } }));
      });
      await openMenu(page, free.title); await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      for (let i = 0; i < 40 && freePayloads.length < 1; i++) await page.waitForTimeout(25);
      assert.equal(freePayloads.length, 1);
      await openMenu(page, nested.title); await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      await page.locator('.chat-row').filter({ hasText: nested.title }).last().locator('button[aria-pressed=true]').waitFor({ state: 'attached' });
      await openMenu(page, free.title); await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
      assert.equal(freePayloads.length, 1);
      first.release();
      for (let i = 0; i < 40 && freePayloads.length < 2; i++) await page.waitForTimeout(25);
      assert.equal(freePayloads.length, 2);
      const saved = freePayloads[1].find(c => c.id === free.id);
      assert.equal(saved.pinned, false);
      assert.equal(saved.archived, true);
      await page.getByRole('alert').getByText(/synthetic first failure/).waitFor();
      await page.locator('.chat-row').filter({ hasText: free.title }).last().waitFor({ state: 'hidden' });
      await page.close();
    }

    // The endpoints clip titles to 120 characters; the visible confirmed name
    // must agree with the server's stored value after a successful rename.
    {
      const original = chat('long-one', 'Short name'); let submitted;
      const page = await makePage(async page => {
        await page.route('**/api/workspace', route => route.fulfill({ json: { projects: [], freeChats: [original] } }));
        await page.route('**/api/freechats', route => { submitted = route.request().postDataJSON().chats; return route.fulfill({ json: { ok: true } }); });
      });
      await openMenu(page, original.title); await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
      const input = page.locator('.proj-rename-input'); await input.waitFor();
      await input.fill('x'.repeat(130)); await input.press('Enter');
      await page.locator('.chat-row').filter({ hasText: 'x'.repeat(120) }).last().waitFor();
      assert.equal(submitted.find(c => c.id === original.id).title.length, 120);
      assert.equal(await page.locator('.chat-row').filter({ hasText: 'x'.repeat(130) }).count(), 0);
      await page.close();
    }

    for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
      const initial = chat('responsive-one', 'Responsive chat');
      const page = await makePage(async page => {
        await page.route('**/api/workspace', route => route.fulfill({ json: { projects: [], freeChats: [initial] } }));
        await page.route('**/api/freechats', route => route.fulfill({ status: 500, json: { error: 'synthetic save failure' } }));
      }, width, theme);
      await openMenu(page, 'Responsive chat'); await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      const alert = page.getByRole('alert'); await alert.waitFor();
      assert.ok(await alert.isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${theme}: horizontal overflow`);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS chat metadata: free/project failures, rename, ordered delayed actions, unrelated fields, stale GET, 375/1440 light/dark');
  } finally { await browser.close(); await fixture.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
