// #1532: the model picker's heading names the chat (or project) it changes. A long chat title ran
// underneath the "Model settings" button and was cut mid-word ("stabl") with no ellipsis, because the
// heading is a flex column and text-overflow never applies to its loose text. The name now sits in
// its own block that truncates with an ellipsis before the button, and the button never shrinks.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/model-picker-header-1532.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31532);
const SHOTS = process.env.QA_SHOTS || '';
const TITLE = 'Search the web: what is the latest stable version of the Rust compiler';
const freeChats = [{ id: 'fc1', title: TITLE, updatedAt: 5000, archived: false, pinned: false }];
const contextProject = { id: '__chat-fc1', name: '', goal: '', instructions: '', memories: [], files: [], chats: [], routing: 'auto', toolboxes: ['core'], modes: ['chat'], createdAt: 1, updatedAt: 1 };

async function openPicker(browser, { width, height }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: contextProject } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Synthetic answer', model: 'Synthetic-Chat-Q4' }], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.composer-model').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  await page.locator('.composer-model').first().click();
  await page.locator('.mp-head').waitFor();
  await page.waitForTimeout(300);
  return page;
}

const geometry = (page) => page.evaluate(() => {
  const head = document.querySelector('.mp-head');
  const name = head.querySelector('.mp-head-name') || head.querySelector('h2');
  const button = head.querySelector('.mp-settings').getBoundingClientRect();
  const nameBox = name.getBoundingClientRect();
  const cs = getComputedStyle(name);
  // text-overflow only applies to a block container that holds the text itself. A flex or grid
  // container (the heading is a flex column) ignores it, so the title is cut with no ellipsis.
  const ellipsisApplies = !/flex|grid/.test(cs.display);
  return {
    nameRight: Math.round(nameBox.right), buttonLeft: Math.round(button.left),
    display: cs.display, ellipsisApplies,
    scrollW: name.scrollWidth, clientW: name.clientWidth,
    clippedMidWord: name.scrollWidth > name.clientWidth + 1 && !ellipsisApplies,
  };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS model-picker-header-1532: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL model-picker-header-1532: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    for (const [width, height] of [[849, 959], [679, 767]]) {
      await check(`#1532 at ${width}px the long chat title ends in an ellipsis before the Model settings button`, async () => {
        const page = await openPicker(browser, { width, height });
        const g = await geometry(page);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `picker-1532-${width}.png`), clip: { x: 0, y: 0, width, height: 420 } });
        assert.ok(g.nameRight <= g.buttonLeft, `the name stops before the button (name right ${g.nameRight}, button left ${g.buttonLeft})`);
        assert.equal(g.clippedMidWord, false, 'the name is not cut mid-word without an ellipsis');
        assert.equal(g.ellipsisApplies, true, `the name's own box can show an ellipsis (display ${g.display})`);
        assert.ok(g.scrollW > g.clientW, 'the long title really is longer than its space (the test is meaningful)');
        await page.close();
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nmodel-picker-header-1532: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
