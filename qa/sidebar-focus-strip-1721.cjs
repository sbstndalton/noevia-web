// noevia#1721 (review of web#56 / #1716): keyboard focus could hide under the sticky New chat strip.
// Shift+Tab upward through a scrolled sidebar list scrolled each newly focused row only just into the
// scroller's padding box, which starts at the top of the scroller, so the row and its focus ring sat
// beneath the strip. The scroller now reserves the strip's measured height (--side-new-h) as
// scroll-padding-top, so a focused row always lands below the strip.
//
// For each family (editorial, glass), light and dark, at 2000 and 390 px:
//  (a) scroll the list to the bottom, focus its last row and Shift+Tab up through every row: each
//      focused row's top is at or below the strip's bottom (its focus ring is never covered);
//  (b) the same for ArrowUp through sidebar search results;
//  (c) Glass only (#1716's `.side-new ~ *` clip-path): the hover card of a project row near the top
//      of a scrolled list and the row's options menu draw outside the clipped blocks and are fully
//      on screen, so the clip never cuts a popover or a data-tip tooltip.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> [QA_SHOTS=<dir>] node qa/sidebar-focus-strip-1721.cjs
// Fails on a build without the change ((a) and (b)), passes with it.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31721);
const SHOTS = process.env.QA_SHOTS || '';
const NAME = 'sidebar-focus-strip-1721';
const chat = (id, title, updatedAt) => ({ id, title, updatedAt, archived: false, pinned: false });
const freeChats = Array.from({ length: 30 }, (_, i) => chat(`fc${i}`, `Synthetic recent chat ${i}`, 9000 - i));
const projects = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Synthetic project ${i}`, pinned: false, archived: false, goal: '', instructions: '', memories: [],
  files: [{ name: `synthetic-notes-${i}.md` }], chats: [], createdAt: 1, updatedAt: 1, modes: ['chat'] }));

async function openSidebar(browser, { family, theme, width, height }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' }));
  await page.addInitScript(([f, t]) => { localStorage.setItem('noevia:theme-family', f); localStorage.setItem('cowork-theme', t); }, [family, theme]);
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects, freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.side-new .new-chat-btn, .nav-drawer-toggle').filter({ visible: true }).first().waitFor({ timeout: 20000 });
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('.side-new .new-chat-btn').filter({ visible: true }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  return page;
}

// Where the focused element is against the strip: null when focus is not on a list row after the strip.
const focusAgainstStrip = (page) => page.evaluate(() => {
  const el = document.activeElement, strip = document.querySelector('.side-new');
  const scroller = strip?.parentElement;
  if (!el || !scroller?.contains(el) || strip.contains(el)) return null;
  if (!(strip.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return { above: true };
  const r = el.getBoundingClientRect(), s = strip.getBoundingClientRect();
  return { top: r.top, stripBottom: s.bottom, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40), scrollTop: scroller.scrollTop };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS ${NAME}: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL ${NAME}: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  const cases = [];
  for (const family of ['editorial', 'glass']) for (const theme of ['light', 'dark']) for (const [width, height] of [[2000, 900], [390, 844]]) cases.push({ family, theme, width, height });
  cases.push({ family: 'editorial', theme: 'light', width: 844, height: 390 }, { family: 'glass', theme: 'dark', width: 844, height: 390 });
  try {
    for (const c of cases) {
      const id = `${c.family} ${c.theme} ${c.width} px`;
      await check(`${id}: Shift+Tab up a scrolled list never leaves the focused row under New chat`, async () => {
        const page = await openSidebar(browser, c);
        try {
          await page.locator('.sidebar-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
          await page.locator('.sidebar-scroll .side-archived').focus();
          let steps = 0, worst = null, shot = false;
          for (; steps < 120; steps++) {
            await page.keyboard.press('Shift+Tab');
            const f = await focusAgainstStrip(page);
            if (!f || f.above) break;
            if (!worst || f.top - f.stripBottom < worst.top - worst.stripBottom) worst = f;
            // The moment a row near the top of the list takes focus: it sits right below the strip.
            if (SHOTS && !shot && /Synthetic project 3$/.test(f.label)) { shot = true; await page.screenshot({ path: path.join(SHOTS, `1721-focus-${c.family}-${c.width}x${c.height}-${c.theme}.png`) }); }
          }
          assert.ok(steps > 20, `focus walked up through the list (${steps} steps)`);
          assert.ok(worst.top >= worst.stripBottom - 0.5, `focused row "${worst.label}" starts at ${worst.top.toFixed(1)} px, under the strip that ends at ${worst.stripBottom.toFixed(1)} px`);
        } finally { await page.close(); }
      });
    }

    // 520 px tall is a short screen (phone.css, max-height 600px): there the whole pane scrolls.
    for (const [theme, height] of [['light', 900], ['dark', 900], ['light', 520], ['dark', 520]]) {
      await check(`glass ${theme} 2000x${height}: ArrowUp through search results keeps the result below New chat`, async () => {
        const page = await openSidebar(browser, { family: 'glass', theme, width: 2000, height });
        try {
          await page.evaluate(() => window.dispatchEvent(new Event('noevia:open-search')));
          const input = page.locator('.sidebar input.shell-search');
          await input.fill('Synthetic');
          await page.keyboard.press('ArrowDown');
          for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
          let worst = null;
          for (let i = 0; i < 40; i++) {
            await page.keyboard.press('ArrowUp');
            const f = await focusAgainstStrip(page);
            if (!f || f.above) break;
            if (!worst || f.top - f.stripBottom < worst.top - worst.stripBottom) worst = f;
          }
          assert.ok(worst, 'search results took focus');
          assert.ok(worst.top >= worst.stripBottom - 0.5, `focused result "${worst.label}" starts at ${worst.top.toFixed(1)} px, under the strip that ends at ${worst.stripBottom.toFixed(1)} px`);
        } finally { await page.close(); }
      });
    }

    for (const [width, height] of [[2000, 900], [390, 844]]) {
      await check(`glass ${width} px: the strip's clip never cuts a row's hover card or options menu`, async () => {
        const page = await openSidebar(browser, { family: 'glass', theme: 'light', width, height });
        try {
          // Scroll so a project row sits just below the strip, half its blocks clipped above it.
          const nearTop = () => page.evaluate(() => {
            const strip = document.querySelector('.side-new'), scroller = strip.parentElement;
            const row = [...document.querySelectorAll('.proj-row')][5];
            scroller.scrollTop += row.getBoundingClientRect().top - strip.getBoundingClientRect().bottom - 2;
            return row.getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
          });
          await page.waitForTimeout(400);
          await nearTop();
          await page.waitForTimeout(200);
          assert.ok(Math.abs(await nearTop()) < 6, 'the row sits just below the strip');
          const row = page.locator('.proj-row').nth(5);
          const fullyShown = (sel) => page.evaluate((s) => {
            const el = document.querySelector(s); if (!el) return 'missing';
            if (el.closest('.side-new ~ *')) return 'inside a clipped block';
            const r = el.getBoundingClientRect();
            const pts = [[r.left + 10, r.top + 10], [r.right - 10, r.top + 10], [r.left + 10, r.bottom - 10], [r.right - 10, r.bottom - 10]];
            const off = pts.find(([x, y]) => x < 0 || y < 0 || x > innerWidth || y > innerHeight);
            if (off) return `off screen at ${off}`;
            // The hover card never takes the pointer, so judge the clip itself: no ancestor clips it.
            for (let a = el; a; a = a.parentElement) if (getComputedStyle(a).clipPath !== 'none') return `clipped by ${a.className}`;
            if (getComputedStyle(el).pointerEvents === 'none') return 'ok';
            const covered = pts.find(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && !el.contains(hit) && !hit.closest('.sidebar-scroll'); });
            return covered ? `covered at ${covered} by ${document.elementFromPoint(...covered).className}` : 'ok';
          }, sel);
          if (width > 600) {
            await row.locator('.project-disclosure').hover();
            await page.locator('.row-card').waitFor({ timeout: 3000 });
            assert.equal(await fullyShown('.row-card'), 'ok', 'hover card');
          }
          await row.hover();
          await row.getByRole('button', { name: /^Options for/ }).click();
          await page.getByRole('menu').waitFor();
          await page.waitForTimeout(200);
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `1721-menu-glass-${width}-light.png`) });
          assert.equal(await fullyShown('[role="menu"]'), 'ok', 'options menu');
        } finally { await page.close(); }
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\n${NAME}: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
