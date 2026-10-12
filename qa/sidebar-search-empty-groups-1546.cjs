// #1546: while the sidebar search is active, the "Your projects" group kept its heading even when no
// project matched the query, leaving an empty heading between the search field and the matching
// recent chats. A group with nothing to show is now hidden while a search is active; the heading
// comes back when a project does match, and the no-results hint still appears when nothing matches.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/sidebar-search-empty-groups-1546.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31546);
const SHOTS = process.env.QA_SHOTS || '';
const chat = (id, title, updatedAt) => ({ id, title, updatedAt, archived: false, pinned: false });
const projects = [{ id: 'p-alpha', name: 'Alpha planning', pinned: false, archived: false, goal: '', instructions: '', memories: [], files: [], createdAt: 1, updatedAt: 1, modes: ['chat'], chats: [] }];
const freeChats = [chat('fc-rust', 'What is the latest stable Rust compiler', 9000), chat('fc-plain', 'Grocery list', 8000)];

async function openSearch(browser) {
  const page = await browser.newPage(withLocale({ viewport: { width: 849, height: 959 } }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects, freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc-plain`);
  await page.locator('.side-footer-search').waitFor({ timeout: 20000 });
  await page.locator('.side-footer-search').click();
  await page.locator('input.shell-search').waitFor();
  return page;
}

const headings = (page) => page.evaluate(() => [...document.querySelectorAll('.sidebar-history .section-toggle')].map((b) => b.textContent.trim()));

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS search-empty-groups-1546: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL search-empty-groups-1546: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    await check('#1546 a query that matches chats but no project hides the "Your projects" heading', async () => {
      const page = await openSearch(browser);
      await page.locator('input.shell-search').fill('rust');
      await page.waitForTimeout(200);
      const h = await headings(page);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'search-1546-rust.png') });
      assert.equal(h.includes('Your projects'), false, `no empty "Your projects" heading, got headings ${JSON.stringify(h)}`);
      assert.equal(await page.locator('.side-scroll-projects').count(), 0, 'the projects group is not rendered at all');
      const chatHits = await page.locator('.side-scroll-chats .nav-item').allTextContents();
      assert.ok(chatHits.some((t) => t.includes('Rust')), 'the matching recent chat is still listed');
      await page.close();
    });

    await check('#1546 a query that matches a project keeps the "Your projects" heading and the project', async () => {
      const page = await openSearch(browser);
      await page.locator('input.shell-search').fill('alpha');
      await page.waitForTimeout(200);
      const h = await headings(page);
      assert.ok(h.includes('Your projects'), `the heading stays when a project matches, got ${JSON.stringify(h)}`);
      assert.ok(await page.locator('.side-scroll-projects .project-disclosure').allTextContents().then((t) => t.some((x) => x.includes('Alpha planning'))), 'the matching project is listed');
      await page.close();
    });

    await check('#1546 a query that matches nothing shows the no-results hint, not an empty heading', async () => {
      const page = await openSearch(browser);
      await page.locator('input.shell-search').fill('zzz-no-match');
      await page.waitForTimeout(200);
      const h = await headings(page);
      assert.equal(h.includes('Your projects'), false, `no empty heading, got ${JSON.stringify(h)}`);
      assert.ok(await page.locator('.side-hint[role="status"]').count() > 0, 'the no-results hint is shown');
      await page.close();
    });

    await check('#1546 with no query the "Your projects" heading and its project still show', async () => {
      const page = await openSearch(browser);
      const h = await headings(page);
      assert.ok(h.includes('Your projects'), `heading present without a query, got ${JSON.stringify(h)}`);
      assert.equal(await page.locator('.side-scroll-projects .project-disclosure').count(), 1, 'the project is listed');
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nsearch-empty-groups-1546: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
