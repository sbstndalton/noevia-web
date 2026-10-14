// #1529: the sidebar's New chat row is sticky inside the scrolling sidebar. Its strip painted no
// surface, so recent-chat rows scrolled underneath it and printed through "New chat". The strip
// now paints an opaque surface (the sidebar's own colour), so list content is clipped beneath it.
// #1716: in Glass the strip is the frosted sidebar itself, so the blocks after it clip their own
// top edge at the strip's bottom instead (qa/sidebar-new-chat-1716.cjs checks the pixels).
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   npm run build -- --outDir ../dist-b1-after   (or any build of the parent commit for the "before" run)
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/sidebar-new-chat-strip-1529.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31529);
const SHOTS = process.env.QA_SHOTS || '';
const chat = (id, title, updatedAt) => ({ id, title, updatedAt, archived: false, pinned: false });
const freeChats = Array.from({ length: 18 }, (_, i) => chat(`fc${i}`, `Synthetic recent chat ${i}`, 7000 - i));
// Enough projects that the sidebar scrolls well past the strip, so recent rows really pass beneath it.
const projects = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `Synthetic project ${i}`, pinned: false, archived: false, goal: '', instructions: '', memories: [], files: [], chats: [], createdAt: 1, updatedAt: 1, modes: ['chat'] }));

const alpha = (css) => {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return 0;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return parts.length === 4 ? parts[3] : 1;
};

async function openSidebar(browser, { family, theme }) {
  const page = await browser.newPage(withLocale({ viewport: { width: 849, height: 959 } }));
  await page.addInitScript(([f, t]) => {
    localStorage.setItem('noevia:theme-family', f);
    localStorage.setItem('cowork-theme', t);
  }, [family, theme]);
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects, freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.side-new .new-chat-btn').waitFor({ timeout: 20000 });
  return page;
}

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS sidebar-new-chat-strip-1529: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL sidebar-new-chat-strip-1529: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    for (const [family, theme] of [['editorial', 'light'], ['editorial', 'dark'], ['glass', 'light'], ['glass', 'dark']]) {
      await check(`#1529 ${family} ${theme}: the scrolled list passes under an opaque New chat strip`, async () => {
        const page = await openSidebar(browser, { family, theme });
        // Scroll the recent list so rows sit underneath the sticky strip.
        await page.locator('.sidebar-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => {
          const strip = document.querySelector('.side-new');
          const scroller = document.querySelector('.sidebar-scroll');
          const sr = strip.getBoundingClientRect(), cr = scroller.getBoundingClientRect();
          // Any list control in the scroller (project rows, recent chats) that sits under the strip.
          const rows = [...scroller.querySelectorAll('button')]
            .filter((el) => !el.closest('.side-new'))
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.top < sr.bottom - 4 && r.bottom > sr.top + 4 && r.top > cr.top);
          return {
            bg: getComputedStyle(strip).backgroundColor,
            stripTop: Math.round(sr.top), stripBottom: Math.round(sr.bottom), scrollerTop: Math.round(cr.top),
            rowsUnderStrip: rows.length,
            scrollTop: scroller.scrollTop,
            family: document.documentElement.dataset.family,
          };
        });
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `strip-1529-${family}-${theme}.png`) });
        assert.ok(m.scrollTop > 0, 'the list really scrolled');
        assert.ok(m.rowsUnderStrip > 0, 'a list row really passes beneath the strip (the test is meaningful)');
        if (family === 'glass') {
          // #1716: Glass's strip is the frosted sidebar itself (see-through); the blocks after it
          // clip their top edge at its bottom, so a row passing beneath it is cut away there.
          const cut = await page.evaluate(() => {
            const strip = document.querySelector('.side-new').getBoundingClientRect();
            const block = [...document.querySelectorAll('.side-new ~ *')].find((el) => {
              const b = el.getBoundingClientRect(); return b.height > 0 && b.top < strip.bottom - 4 && b.bottom > strip.bottom;
            });
            if (!block) return null;
            const box = block.getBoundingClientRect();
            const clip = getComputedStyle(block).clipPath.match(/inset\(([\d.]+)(px|%)/);
            const top = !clip ? 0 : clip[2] === '%' ? (Number(clip[1]) / 100) * box.height : Number(clip[1]);
            return { visibleTop: box.top + top, stripBottom: strip.bottom };
          });
          assert.ok(cut, 'a block passes beneath the strip');
          assert.ok(Math.abs(cut.visibleTop - cut.stripBottom) <= 2, `the block under the strip is clipped at its bottom edge (visible from ${cut.visibleTop}, strip ends ${cut.stripBottom})`);
        } else {
          assert.equal(alpha(m.bg), 1, `the strip paints an opaque surface, got ${m.bg}`);
        }
        assert.ok(Math.abs(m.stripTop - m.scrollerTop) <= 1, 'the strip is stuck to the top of the scroller');
        await page.close();
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nsidebar-new-chat-strip-1529: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
