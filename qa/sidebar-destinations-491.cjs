// #491: search existing app destinations using synthetic workspace/profile data only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const port = 31591;
const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-ui-491-shots';
const origin = `http://localhost:${port}`;
const project = { id: 'synthetic-project', name: 'Research Studio', pinned: false, chats: [] };
const chat = { id: 'synthetic-chat', title: 'Research notes', updatedAt: 1000, pinned: false, archived: false, messages: [] };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(port);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: process.env.QA_CHANNEL || 'chrome' });
  const errors = [];
  const makePage = async (width, theme, diaryEnabled = true) => {
    const page = await browser.newPage(withLocale({ viewport: { width, height: width === 390 ? 844 : 900 } }));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/workspace', (route) => route.fulfill({ json: { projects: [project], freeChats: [chat] } }));
    if (!diaryEnabled) {
      const user = { id: 'synthetic-member', username: 'fixture', displayName: 'Synthetic member', role: 'member', diaryEnabled: false, onboarded: true };
      await page.route('**/api/profile', (route) => route.fulfill({ json: { user, passkeys: [] } }));
      await page.route('**/api/auth/session', (route) => route.fulfill({ json: { user, passkeys: [] } }));
    }
    await page.goto(origin);
    await page.evaluate((choice) => {
      localStorage.setItem('cowork-theme', choice);
      localStorage.setItem('noevia:sidebar-collapsed', '0');
    }, theme);
    await page.reload();
    await page.getByPlaceholder('Message noevia…').waitFor();
    if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click();
    else await page.getByRole('button', { name: /Search (noevia|projects and chats)/ }).first().click();
    const search = page.getByRole('textbox', { name: /Search (noevia|projects and chats)/ });
    await search.waitFor();
    return { page, search };
  };
  try {
    const { page, search } = await makePage(1440, 'light');
    await search.fill('di');
    const diary = page.locator('.side-scroll-destinations .side-destination', { hasText: 'Diary' });
    await diary.waitFor({ timeout: 5000 });
    assert.equal(await diary.count(), 1, 'enabled Diary is a searchable destination');
    await search.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Diary');
    await page.keyboard.press('Escape');
    assert.equal(await search.inputValue(), 'di', 'Escape from a result returns to search without clearing');
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname.includes('diary'));
    console.log('PASS #491: keyboard enters, backs out of, and opens an available destination');

    await page.getByRole('button', { name: /Search (noevia|projects and chats)/ }).first().click();
    await search.fill('settings');
    assert.equal(await page.locator('.sidebar [aria-live="polite"]').textContent(), '1 result');
    await search.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    console.log('PASS #491: Settings result count and existing settings route');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.close();

    const disabled = await makePage(1440, 'light', false);
    await disabled.search.fill('diary');
    assert.equal(await disabled.page.locator('.side-scroll-destinations .side-destination').count(), 0, 'disabled Diary is excluded');
    await disabled.page.getByText('No matching chats, projects or pages.').waitFor();
    console.log('PASS #491: unavailable Diary is excluded and no-results copy is truthful');
    await disabled.page.close();

    for (const theme of ['light', 'dark']) for (const width of [1440, 768, 390]) {
      const { page: shot, search: field } = await makePage(width, theme);
      await field.fill('s');
      await shot.locator('.side-scroll-destinations .side-destination').first().waitFor();
      const visibleDestinations = await shot.locator('.side-scroll-destinations .side-destination').allTextContents();
      assert.ok(visibleDestinations.some((label) => label.includes('Projects')), `${width}/${theme}: Projects result visible`);
      assert.ok(visibleDestinations.some((label) => label.includes('Settings')), `${width}/${theme}: Settings result visible`);
      assert.ok(await shot.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${theme}: no horizontal overflow`);
      if (width === 390) await shot.waitForFunction(() => {
        const drawer = document.querySelector('.sidebar.pane');
        return drawer && drawer.getBoundingClientRect().left >= -0.5;
      });
      await shot.screenshot({ path: `${out}/destinations-${width}-${theme}.png`, fullPage: true });
      if (width === 390) {
        await field.fill('projects');
        await shot.locator('.side-scroll-destinations .side-destination', { hasText: 'Projects' }).click();
        await shot.getByRole('dialog', { name: 'Navigation' }).waitFor({ state: 'hidden' });
        await shot.waitForFunction(() => location.pathname.includes('projects'));
      }
      await shot.close();
    }
    assert.deepEqual(errors, [], 'no browser errors');
    console.log('PASS #491: responsive light/dark screenshots and phone drawer navigation');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
