// #1542: a project named "QA Haiku 20261012-0610 renamed" wrapped between "20261012-" and "0610", so the
// identifier read as two names. The same break happened in the storage path shown on the project page
// and in the Sources row path. The identifier now stays on one line; the name still wraps at its spaces.
//
// The check measures the rendered text: the characters of each identifier must sit on one line
// (a range over them yields a single client rect), at the owner's 849 px desktop and at a narrow 600 px.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/project-title-identifier-1542.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31542);
const SHOTS = process.env.QA_SHOTS || '';
const NAME = 'QA Haiku 20261012-0610 renamed';
const FOLDER = 'noevia projects/QA Haiku 20261012-0610 renamed';
const project = {
  id: 'p-qa', name: NAME, goal: '', instructions: '', memories: [], createdAt: 1, updatedAt: 1, modes: ['chat'],
  projectFolder: FOLDER, sourceFolders: [FOLDER], chats: [],
  files: [{ name: `${FOLDER}/Documents/qa_two_page.pdf`, source: FOLDER, bytes: 10 }],
};
// #1542 (2026-10-12 local QA): a long name with no digits must wrap between its words, not inside them.
const LONG_NAME = 'Synthetic project proj-synthetic-identifier-long-hyphenated-name';
const longProject = { ...project, id: 'p-long', name: LONG_NAME, projectFolder: undefined, sourceFolders: [], files: [] };

// A word such as "identifier" as rendered: a range over its characters must be one line box.
const wordOnOneLine = (page, selector, word) => page.evaluate(([sel, w]) => {
  for (const el of document.querySelectorAll(sel)) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(w);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + w.length);
      return range.getClientRects().length;
    }
  }
  return -1;
}, [selector, word]);

// The identifier "20261012-0610" as rendered: a range over its characters must be one line box.
const identifierLines = (page, selector) => page.evaluate(([sel]) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf('20261012');
      if (i < 0) continue;
      const j = node.textContent.indexOf('0610', i);
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, j + 4);
      out.push({ lines: range.getClientRects().length, text: node.textContent.replace(/⁠/g, '') });
    }
  }
  return out;
}, [selector]);

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function openProject(browser, width, proj = project) {
  const phone = width < 500; // the phone layout is only applied to a phone user agent, as a real phone sends
  const page = await browser.newPage(withLocale({ viewport: { width, height: 900 }, ...(phone ? { hasTouch: true, isMobile: true, userAgent: IPHONE } : {}) }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [proj], freeChats: [] } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto('http://localhost:' + PORT + '/p/' + proj.id);
  await page.locator('h1.project-title').waitFor({ timeout: 20000 });
  return page;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS project-title-identifier-1542: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL project-title-identifier-1542: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  try {
    for (const width of [849, 640]) {
      await check(`#1542 at ${width}px the project name keeps its identifier on one line`, async () => {
        const page = await openProject(browser, width);
        const title = await identifierLines(page, 'h1.project-title');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `project-title-1542-${width}.png`) });
        assert.equal(title.length, 1, 'the title is found');
        assert.equal(title[0].text, NAME, 'the text is still the project name');
        assert.equal(title[0].lines, 1, `the identifier is on one line (line boxes: ${title[0].lines})`);
        await page.close();
      });
    }

    for (const width of [849, 390]) {
      await check(`#1542 at ${width}px a long hyphenated name wraps at its hyphens; the word "identifier" is not split`, async () => {
        const page = await openProject(browser, width, longProject);
        await page.locator('h1.project-title').waitFor({ timeout: 20000 });
        await page.getByRole('tab', { name: /Sources/ }).click();
        await page.locator('.project-sources').first().waitFor({ timeout: 5000 });
        const rects = await wordOnOneLine(page, 'h1.project-title', 'identifier');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `project-title-long-1542-${width}.png`) });
        assert.equal(rects, 1, `"identifier" is on one line (line boxes: ${rects})`);
        await page.close();
      });
    }

    await check('#1542 at 640px the storage path and the Sources rows keep the identifier on one line', async () => {
      const page = await openProject(browser, 640);
      await page.locator('button.chip', { hasText: 'Sources' }).click();
      await page.locator('.source-list .source-status').first().waitFor({ timeout: 5000 });
      const storage = await identifierLines(page, '.storage-path');
      assert.ok(storage.length >= 1, 'the storage path is shown');
      for (const s of storage) assert.equal(s.lines, 1, `storage path identifier on one line (line boxes: ${s.lines})`);
      const sources = await identifierLines(page, '.source-list .source-status');
      assert.ok(sources.length >= 1, 'a Sources row shows the path');
      for (const s of sources) assert.equal(s.lines, 1, `Sources path identifier on one line (line boxes: ${s.lines})`);
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nproject-title-identifier-1542: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
