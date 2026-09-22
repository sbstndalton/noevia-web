// Synthetic projects only: native card controls, tabs, filters and archive recovery.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { navClick } = require('./nav.cjs');
(async () => {
  const fixture = createFixture(31421); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [375, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 }, hasTouch: width < 768 });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const projects = ['HomeLab', 'Writing & research', 'An unusually long project name that still needs to be readable'].map((name, i) => ({
        id: `p${i}`, name, goal: ['Keep the server boring.', 'Collect sources and develop ideas for the next essay.', 'A place for the next small adventure.'][i],
        instructions: '', memories: [], sourceFolders: [], modes: ['chat'], files: [], chats: [], assets: [], toolboxes: [], updatedAt: Date.now(), createdAt: Date.now(), pinned: i === 0,
      }));
      await page.route('**/api/workspace', r => r.fulfill({ json: { projects, freeChats: [] } }));
      await page.goto('http://localhost:31421'); await page.getByPlaceholder('Message noevia…').waitFor();
      await navClick(page, 'Projects');
      const library = page.locator('.projects-workspace');
      await library.getByRole('button', { name: 'Open project HomeLab', exact: true }).waitFor();
      assert.equal(await library.getByText('Pinned', { exact: true }).count(), 1);
      const active = library.getByRole('tab', { name: 'Your projects' });
      await active.focus(); await page.keyboard.press('ArrowRight');
      await library.getByText('No archived projects', { exact: true }).waitFor();
      assert.equal(await library.getByRole('tab', { name: 'Archived' }).getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Home');
      await library.getByLabel('Filter projects').fill('NO-MATCH');
      await library.getByRole('button', { name: 'Clear filter' }).click();
      assert.ok(await library.getByLabel('Filter projects').evaluate(el => el === document.activeElement));
      await library.getByRole('button', { name: 'Project options for HomeLab' }).click();
      await page.getByRole('menuitem', { name: 'Project settings' }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'detached' });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await page.waitForTimeout(150);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}: overflow`);
        await page.locator('.projects-hero').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/noevia-projects-polish-${width}-${theme}.png` });
      }
      await library.getByRole('button', { name: 'Open project HomeLab', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'HomeLab', exact: true }).waitFor();
      projects.forEach(p => { p.archived = true; });
      await page.reload(); await navClick(page, 'Projects');
      await library.getByText('No active projects', { exact: true }).waitFor();
      await library.getByRole('button', { name: 'View archived projects' }).click();
      await library.getByRole('button', { name: 'Restore', exact: true }).first().waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS projects library: keyboard cards/tabs, independent menus, pin state, filter focus, all-archived recovery, 375/768/1440 light/dark.');
  } finally { await browser.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
