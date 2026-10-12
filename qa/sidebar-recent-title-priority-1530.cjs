// #1530: a recent chat that belongs to a project shows the project name as a tag beside its title.
// The tag took up to 40% of the row beside the title, so titles fell to about five characters
// ("QA Haiku ...") and two different chats read the same. The project name now sits on its own line
// under the title, so the title keeps the whole row; the full name stays as the tag's tooltip.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/sidebar-recent-title-priority-1530.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31530);
const SHOTS = process.env.QA_SHOTS || '';
const PROJECT_NAME = 'QA Haiku 20261012-0610 renamed';
const chat = (id, title, updatedAt, extra = {}) => ({ id, title, updatedAt, archived: false, pinned: false, ...extra });
const projects = [{
  id: 'p-qa', name: PROJECT_NAME, pinned: false, archived: false, goal: '', instructions: '', memories: [], files: [], createdAt: 1, updatedAt: 1, modes: ['chat'],
  chats: [chat('pc1', 'QA Haiku chat one', 9000, { projectId: 'p-qa' }), chat('pc2', 'QA Haiku chat two', 8000, { projectId: 'p-qa' })],
}];
const freeChats = [chat('fc1', 'Plain free chat', 7000)];

async function openApp(browser, { width, height }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: JSON.parse(JSON.stringify(projects)), freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.side-scroll-chats .chat-row').first().waitFor({ timeout: 20000 });
  return page;
}

const measure = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.side-scroll-chats .chat-row')].filter((r) => r.querySelector('.chat-row-context'));
  return rows.map((row) => {
    const nav = row.querySelector('.nav-item').getBoundingClientRect();
    const label = row.querySelector('.sidebar-label').getBoundingClientRect();
    const tag = row.querySelector('.chat-row-context').getBoundingClientRect();
    const text = row.querySelector('.sidebar-label-text').textContent;
    return { text, navW: Math.round(nav.width), labelW: Math.round(label.width), labelBottom: Math.round(label.bottom), tagTop: Math.round(tag.top), tagW: Math.round(tag.width), tagTitle: row.querySelector('.chat-row-context').getAttribute('title'), tagText: row.querySelector('.chat-row-context').textContent };
  });
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS recent-title-1530: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL recent-title-1530: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  try {
    for (const [width, height] of [[849, 959], [1440, 900]]) {
      await check(`#1530 at ${width}px a project chat keeps its title readable and the tag yields first`, async () => {
        const page = await openApp(browser, { width, height });
        const rows = await measure(page);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `recent-1530-${width}.png`) });
        assert.equal(rows.length, 2, 'both project chats are listed in Recent chats');
        for (const r of rows) {
          // The title has the row to itself: it is not squeezed beside the project name (about 16+ characters).
          assert.ok(r.labelW >= r.navW * 0.7, `title "${r.text}" has most of the row (label ${r.labelW}px of ${r.navW}px)`);
          // The project name sits on its own line under the title, so the two never share the width.
          assert.ok(r.tagTop >= r.labelBottom - 2, `tag "${r.tagText}" sits below the title line (tag top ${r.tagTop}, title bottom ${r.labelBottom})`);
          assert.equal(r.tagTitle, PROJECT_NAME, 'the tag carries the full project name as its tooltip');
        }
        await page.close();
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nrecent-title-1530: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
