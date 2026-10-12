// Synthetic layout regression, not Safari hardware proof. UNRUN until a separate QA grant.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { navClick, openSettings } = require('./nav.cjs');

async function reachable(locator, height) {
  assert.ok(await locator.evaluate((el, h) => {
    const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return r.width > 0 && r.height > 0 && y >= 0 && y < h && el.contains(document.elementFromPoint(x, y));
  }, height), 'Control remains reachable without scrolling the outer workspace');
}
async function keyboardScroll(locator) {
  await locator.focus();
  assert.ok(await locator.evaluate(el => el === document.activeElement), 'Error text is a keyboard destination');
  await locator.evaluate(el => { el.scrollTop = 0; });
  await locator.press('End');
  await locator.page().waitForFunction(() => {
    const el = document.activeElement;
    return el && el.scrollTop > 0;
  });
  assert.ok(await locator.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), 'Keyboard reaches the complete error tail');
}

(async () => {
  const fixture = createFixture(0);
  await fixture.listen();
  const origin = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  try {
    for (const [width, height, forcedPhone] of [[320, 568, false], [390, 844, false], [667, 375, false], [1440, 900, true], [1440, 900, false]]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: width <= 700, hasTouch: width <= 700 });
      if (forcedPhone) await page.addInitScript(() => localStorage.setItem('cowork-layout-mode', 'mobile'));
      page.on('pageerror', error => errors.push(error.message));
      const project = { id: 'layout', name: 'Synthetic layout', goal: '', instructions: 'Synthetic instructions', memories: Array.from({ length: 80 }, (_, i) => `Synthetic memory ${i}`), files: [], chats: [{ id: 'layout-chat', title: 'Synthetic discussion', updatedAt: 1 }], sourceFolders: ['Synthetic folder'], createdAt: 1, updatedAt: 1 };
      let singleError = false;
      await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/workspace') return route.fulfill({ json: { projects: [project], freeChats: [] } });
        if (path === '/api/projects/layout/skills') return route.fulfill({ json: { skills: [] } });
        if (path === '/api/projects/layout/sources/sync') return route.fulfill({ json: { files: [], skipped: Array.from({ length: singleError ? 1 : 12 }, (_, i) => ({ folder: singleError ? 'Synthetic long folder '.repeat(100) : `Synthetic folder ${i} with a long bounded name`, reason: 'storage returned 401', retained: true })) } });
        if (path === '/api/chats/layout-chat/history') return route.fulfill({ json: { history: [{ role: 'user', content: 'Synthetic message' }, { role: 'assistant', content: 'Synthetic reply' }] } });
        return route.continue();
      });
      await page.goto(origin);
      await navClick(page, 'Projects');
      await page.getByText(project.name, { exact: true }).last().click();
      const toast = page.locator('.save-error-storage');
      await toast.waitFor();
      if (width > 1100 && !forcedPhone) {
        await toast.getByRole('button', { name: 'Dismiss', exact: true }).click();
        await page.getByText('Synthetic discussion', { exact: true }).last().click();
        const rail = page.locator('#noevia-inspector');
        await rail.waitFor();
        assert.equal(await rail.locator('.insp-toggle').isVisible(), false);
        assert.equal(await rail.locator('.insp-content').isVisible(), true, 'Desktop wrapper remains visible');
        await page.close();
        continue;
      }
      const list = toast.locator('.save-error-list');
      assert.ok(await list.evaluate(el => el.clientWidth >= el.parentElement.clientWidth * 0.65), 'Error text keeps a readable width');
      assert.equal(await list.locator('li').count(), 12, 'Every error remains present');
      await keyboardScroll(list);
      await reachable(toast.getByRole('button', { name: 'Dismiss', exact: true }), height);
      await reachable(toast.getByRole('button', { name: 'Open storage settings', exact: true }), height);
      await toast.getByRole('button', { name: 'Open storage settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.waitFor();
      assert.equal(await toast.count(), 0, 'Alert controls leave the modal accessibility tree');
      await settings.getByRole('button', { name: 'All settings', exact: true }).click();
      await settings.getByRole('button', { name: 'Appearance & language', exact: true }).click();
      if (width <= 700 || forcedPhone) assert.ok(await settings.evaluate(el => {
        const pane = el.querySelector('.settings-detail-scroll'), r = el.getBoundingClientRect();
        return r.bottom <= innerHeight + 1 && r.top >= -1 && pane.clientHeight > 0 && getComputedStyle(pane).overflowY === 'auto' && [...pane.children].every(child => !child.style.zoom);
      }), 'Settings fills the bounded sheet and keeps one unscaled content scroller');
      await reachable(settings.getByRole('button', { name: 'Close settings', exact: true }), height);
      await page.keyboard.press('Escape');
      await settings.waitFor({ state: 'hidden' });
      await toast.waitFor();
      assert.equal(await toast.locator('li').count(), 12, 'Settings close restores every error');
      await toast.getByRole('button', { name: 'Dismiss', exact: true }).click();
      singleError = true;
      await page.getByRole('button', { name: 'Refresh from storage', exact: true }).click();
      const message = toast.locator('.save-error-message');
      await message.waitFor();
      await keyboardScroll(message);
      assert.ok((await message.textContent()).includes('Synthetic long folder '.repeat(100)), 'Single error is retained completely');
      await toast.getByRole('button', { name: 'Dismiss', exact: true }).click();
      await page.getByText('Synthetic discussion', { exact: true }).last().click();
      const inspector = page.locator('#noevia-inspector');
      await inspector.waitFor();
      const toggle = inspector.getByRole('button', { name: 'Project context', exact: true });
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await inspector.locator('.insp-content').isVisible(), false);
      const composer = page.getByPlaceholder('Message noevia…');
      await reachable(composer, height);
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await inspector.locator('.insp-content').isVisible(), true);
      assert.ok(await inspector.evaluate(el => el.clientHeight <= el.parentElement.clientHeight * 0.45 + 1));
      await inspector.getByRole('heading', { name: 'Instructions', exact: true }).waitFor();
      const content = inspector.locator('.insp-content');
      await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await content.evaluate(el => el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2), 'Long context scrolls to its bottom');
      await reachable(inspector.getByText('Synthetic memory 79', { exact: true }), height);
      await reachable(composer, height);
      await toggle.click();
      await reachable(composer, height);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await openSettings(page);
      await reachable(page.getByRole('button', { name: 'Close settings', exact: true }), height);
      assert.equal(await inspector.evaluate(el => el.inert), true, 'Context actions behind Settings are inert');
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS synthetic mobile layout: readable complete alert, reachable actions, bounded Settings, context disclosure and composer retention. Chromium only.');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
