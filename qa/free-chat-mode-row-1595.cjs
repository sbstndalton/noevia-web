// #1595: in a free chat the mode row ran the Chat caption and the #1564 hint together: "Chat Task · Runs a
// conversational reply  Runs inside a project  Open Projects", one run-on line that read as if Chat runs
// inside a project. The hint now names its subject ("Task runs inside a project.") and sits on its own line
// under the Chat caption; the disabled Task option carries it as a tooltip too.
//
// Offline: the app is built from this checkout and every API is a synthetic stub.
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] node qa/free-chat-mode-row-1595.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31595);
const SHOTS = process.env.QA_SHOTS || '';
const TAG = process.env.QA_TAG || 'after';
const freeChats = [{ id: 'fc1', title: 'Synthetic free chat', updatedAt: 5000, archived: false, pinned: false }];
const history = [{ role: 'user', content: 'Synthetic question.' }, { role: 'assistant', content: 'Synthetic answer.', model: 'Synthetic-Chat-Q4' }];

async function open(browser, { width, height }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history, revision: 'r1' } }));
  await page.route('**/api/chats/*/context', (r) => r.fulfill({ json: { project: null } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.composer-mode-harness').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  return page;
}

// Boxes of the Chat caption text (first line of text in the caption) and of the hint, in viewport pixels.
const geometry = (page) => page.evaluate(() => {
  const harness = document.querySelector('.composer-mode-harness');
  const walker = document.createTreeWalker(harness, NodeFilter.SHOW_TEXT);
  let caption = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/conversational reply/i.test(n.textContent)) { caption = n; break; }
  const range = document.createRange(); range.selectNodeContents(caption);
  const c = range.getBoundingClientRect();
  const hint = harness.querySelector('.composer-mode-hint');
  const h = hint.getBoundingClientRect();
  const open = harness.querySelector('.composer-mode-open');
  const o = open.getBoundingClientRect();
  const task = document.querySelector('.composer-mode-toggle [data-mode="cowork"], .composer [data-mode="cowork"]');
  const vis = (r) => r.width > 0 && r.height > 0;
  return {
    captionText: caption.textContent.trim(), hintText: hint.textContent.trim(),
    caption: { top: c.top, bottom: c.bottom, left: c.left, right: c.right },
    hint: { top: h.top, bottom: h.bottom, left: h.left, right: h.right },
    open: { top: o.top, bottom: o.bottom, visible: vis(o) },
    hintInsideCaptionElement: !!caption.parentElement.contains(hint),
    taskDisabled: task ? task.disabled : null, taskTitle: task ? task.title : null,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  let failed = 0;
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS free-chat-mode-row-1595: ${name}`); }
    catch (e) { failed++; console.log(`FAIL free-chat-mode-row-1595: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  try {
    for (const [name, size] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
      await check(`${name} px: the hint is on its own line under the Chat caption`, async () => {
        const page = await open(browser, size);
        const g = await geometry(page);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mode-row-1595-${TAG}-${name}.png`) });
        await page.close();
        assert.equal(g.captionText, 'Runs a conversational reply');
        assert.match(g.hintText, /^Task runs inside a project\.$/, 'the hint names Task as its subject');
        assert.ok(g.hint.top >= g.caption.bottom - 1, `the hint starts below the caption (hint top ${g.hint.top}, caption bottom ${g.caption.bottom})`);
        assert.ok(Math.abs(g.hint.bottom - g.caption.bottom) > 4, 'the two do not share a baseline');
        assert.ok(g.open.visible && g.open.top >= g.caption.bottom - 1, 'Open Projects is beside the hint, not the caption');
        assert.equal(g.overflowX, false, 'the row does not overflow sideways');
      });
      await check(`${name} px: the disabled Task option carries the hint as its tooltip`, async () => {
        const page = await open(browser, size);
        const g = await geometry(page);
        await page.close();
        assert.equal(g.taskDisabled, true);
        assert.equal(g.taskTitle, 'Task runs inside a project.');
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  process.exit(failed ? 1 : 0);
})();
