// #448: the Glass family's sidebar sticky strips (.side-new, .side-footer, and the sticky
// section heads) used to sit on `background: transparent` and lean entirely on
// `backdrop-filter: blur(var(--pane-blur))` to obscure whatever scrolls beneath them. In
// Chromium, a sticky descendant's own backdrop-filter silently fails to sample content when
// its ancestor (.sidebar.pane) is itself a frosted pane with its own backdrop-filter — a
// nested backdrop-root — so the blur never painted and real chat-row titles showed straight
// through the MCP status line and the account row.
//
// Root cause, confirmed here (not by theory): with the parent pane's backdrop-filter present,
// a sticky strip's own blur(24px) does not render at all; remove only the parent's
// backdrop-filter and the exact same child rule renders correctly (see the write-up in the fix
// commit/PR). families.css now gives these strips an unconditional translucent tint — a
// color-mix of the opaque surface tone plus a touch of --glass-sheet — so they stay legible
// even where the nested blur is a no-op, while any working backdrop-filter still layers on top.
//
// This script builds ~40 synthetic recent chats (well over the 15-chat fold) so the sidebar
// overflows, expands "View all", scrolls with a real page.mouse.wheel so a chat row's title
// sits directly beneath the sticky footer, and takes an element screenshot of .side-footer.
// It compares that screenshot, pixel for pixel, against the same element screenshotted with an
// empty chat list (nothing to bleed through) — on origin/main the two differ hugely (the
// scrolled title paints straight through); on the fix they are near-identical. elementsFromPoint
// additionally proves a real chat row sits under the footer's own bounding box, and a computed-
// style check proves the strip's own background is no longer literally `transparent`.
//
//   PLAYWRIGHT_MODULE=~/noevia-local-test/node_modules/playwright-core \
//   QA_DIST=/tmp/some-dist QA_SCREENSHOTS=/tmp/noevia-qa-448/shots/after node qa/glass-sticky-strips-448.cjs
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const { withLocale } = require('./qa-locale.cjs');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = 31448;
const out = process.env.QA_SCREENSHOTS || '/tmp/noevia-qa-448/shots';
// Well past RECENT_LIMIT (15, Sidebar.tsx) so the list overflows even before "View all".
const CHAT_COUNT = 42;
const user = { id: 'synthetic-448', username: 'glassqa', displayName: 'Glass QA', role: 'member', diaryEnabled: false, onboarded: true };
const chats = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, title: `Synthetic recent chat number ${i} with a title long enough to fill the row`, updatedAt: 100000 - i, pinned: false }));

async function mockBase(page, theme, family, freeChats) {
  // The same route the app itself reads to bootstrap: session/profile for identity, appearance
  // for the theme, workspace for the sidebar's chat list. The family attribute is set the way
  // theme.js actually applies it — from localStorage, before first paint — same as
  // qa/theme-families.cjs.
  await page.addInitScript(({ family }) => { localStorage.setItem('noevia:theme-family', family); }, { family });
  await page.route('**/api/profile', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/auth/session', (r) => r.fulfill({ json: { user, passkeys: [] } }));
  await page.route('**/api/profile/appearance', (r) => r.fulfill({ json: { theme, light: 'iris', dark: 'iris' } }));
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
}

// Scroll the sidebar with a real wheel gesture until a chat row's box genuinely overlaps the
// sticky footer's own bounding rect (elementsFromPoint proves it, not just a guessed offset).
async function scrollUntilOverlap(page) {
  const sidebar = page.locator('.app .sidebar.pane');
  await sidebar.waitFor();
  const viewAll = page.getByRole('button', { name: /View all \d+ chats/ });
  if (await viewAll.count()) await viewAll.click();
  const box = await sidebar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const { scrollHeight, clientHeight } = await page.evaluate(() => { const el = document.querySelector('.app .sidebar.pane'); return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; });
  const overflow = scrollHeight - clientHeight;
  assert.ok(overflow > 100, `sidebar must overflow for this test to mean anything: ${overflow}px`);
  await page.mouse.wheel(0, Math.round(overflow * 0.4));
  await page.waitForTimeout(200);
  const overlap = await page.evaluate(() => {
    const footer = document.querySelector('.app .sidebar.pane .side-footer');
    const rect = footer.getBoundingClientRect();
    const pt = { x: rect.left + 12, y: rect.top + rect.height - 6 };
    return document.elementsFromPoint(pt.x, pt.y).map((e) => e.className.toString());
  });
  assert.ok(overlap.some((c) => /\bchat-row\b/.test(c)), `a real chat row must sit under the footer's own point (elementsFromPoint): ${JSON.stringify(overlap)}`);
  return overlap;
}

// Decode both PNGs in a throwaway blank page (native <canvas>/<img>, no extra dependency) and
// return the fraction of pixels that differ by more than a small per-channel tolerance.
async function pixelDiffFraction(browser, bufA, bufB) {
  const page = await browser.newPage();
  try {
    await page.goto('about:blank');
    const fraction = await page.evaluate(async ([a, b]) => {
      const load = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
      const [imgA, imgB] = await Promise.all([load('data:image/png;base64,' + a), load('data:image/png;base64,' + b)]);
      const w = Math.min(imgA.width, imgB.width), h = Math.min(imgA.height, imgB.height);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgA, 0, 0, w, h);
      const dataA = ctx.getImageData(0, 0, w, h).data;
      ctx.clearRect(0, 0, w, h); ctx.drawImage(imgB, 0, 0, w, h);
      const dataB = ctx.getImageData(0, 0, w, h).data;
      let diff = 0;
      for (let i = 0; i < dataA.length; i += 4) {
        const d = Math.abs(dataA[i] - dataB[i]) + Math.abs(dataA[i + 1] - dataB[i + 1]) + Math.abs(dataA[i + 2] - dataB[i + 2]);
        if (d > 45) diff++;
      }
      return diff / (w * h);
    }, [bufA.toString('base64'), bufB.toString('base64')]);
    return fraction;
  } finally { await page.close(); }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const fixture = createFixture(PORT); await fixture.listen();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = []; const results = []; const failures = [];
  // Soft-assert: record a failure but keep going, so every case still produces its full
  // fail/pass evidence (both screenshots, the diff number) instead of aborting on the first
  // broken case — important for capturing what origin/main actually looks like.
  const check = (ok, message) => { if (!ok) failures.push(message); };
  try {
    // The three configurations the fix must hold for: 1440 light, 1440 dark, 768 dark.
    const cases = [
      { width: 1440, height: 900, theme: 'light', label: '1440-light' },
      { width: 1440, height: 900, theme: 'dark', label: '1440-dark' },
      { width: 768, height: 900, theme: 'dark', label: '768-dark' },
    ];
    for (const { width, height, theme, label } of cases) {
      const page = await browser.newPage(withLocale({ viewport: { width, height } }));
      page.on('pageerror', (e) => errors.push({ label, error: e.message }));
      await mockBase(page, theme, 'glass', chats(CHAT_COUNT));
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      await page.evaluate(() => document.fonts.ready);

      await scrollUntilOverlap(page);
      const footer = page.locator('.app .sidebar.pane .side-footer');
      await page.waitForTimeout(150);
      const overlapBuf = await footer.screenshot();
      fs.writeFileSync(path.join(out, `glass-footer-${label}-overlap.png`), overlapBuf);

      const bg = await footer.evaluate((el) => getComputedStyle(el).backgroundColor);
      const alpha = parseFloat((/,\s*([\d.]+)\s*\)/.exec(bg) || [, '1'])[1]);
      check(alpha > 0.6, `${label}: .side-footer's own background must not be (near-)transparent — computed ${bg}`);

      // Same footer, same viewport/theme, nothing scrolling beneath it — the legibility baseline.
      await page.unroute('**/api/workspace');
      await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats: [] } }));
      await page.reload();
      await page.getByPlaceholder('Message noevia…').waitFor();
      await page.waitForTimeout(150);
      const emptyBuf = await footer.screenshot();
      fs.writeFileSync(path.join(out, `glass-footer-${label}-empty.png`), emptyBuf);

      const diff = await pixelDiffFraction(browser, overlapBuf, emptyBuf);
      results.push({ label, alpha, diff, bg });
      // On origin/main this fraction is large (the scrolled chat row's title paints straight
      // through, visibly different from the empty-list baseline); on the fix it is small.
      check(diff < 0.06, `${label}: .side-footer over scrolled rows must look ~the same as over an empty list (blur/tint hides them) — ${(diff * 100).toFixed(1)}% of pixels differ`);
      await page.close();
    }

    // The other families never had this bug (their strips paint a solid background already) —
    // prove the fix is scoped to Glass and did not touch them.
    for (const family of ['editorial', 'contemporary']) {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
      page.on('pageerror', (e) => errors.push({ family, error: e.message }));
      await mockBase(page, 'dark', family, chats(CHAT_COUNT));
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      await scrollUntilOverlap(page);
      const footer = page.locator('.app .sidebar.pane .side-footer');
      await page.waitForTimeout(150);
      const overlapBuf = await footer.screenshot();
      fs.writeFileSync(path.join(out, `${family}-footer-overlap.png`), overlapBuf);
      const bg = await footer.evaluate((el) => getComputedStyle(el).backgroundColor);
      const alpha = parseFloat((/,\s*([\d.]+)\s*\)/.exec(bg) || [, '1'])[1]);
      check(alpha > 0.6, `${family}: .side-footer was already opaque and must remain so — computed ${bg}`);
      results.push({ family, alpha, bg });
      await page.close();
    }

    // Collapsed sidebar: the footer becomes non-sticky/static with no background of its own
    // (phone.css) — the new Glass rule must not leak a background into that state.
    {
      const page = await browser.newPage(withLocale({ viewport: { width: 1440, height: 900 } }));
      page.on('pageerror', (e) => errors.push({ collapsed: true, error: e.message }));
      await mockBase(page, 'dark', 'glass', chats(CHAT_COUNT));
      await page.goto(`http://localhost:${PORT}`);
      await page.getByPlaceholder('Message noevia…').waitFor();
      const collapse = page.locator('.side-expand, [aria-label="Collapse sidebar"]').first();
      await collapse.click();
      await page.waitForTimeout(150);
      const state = await page.evaluate(() => {
        const sidebar = document.querySelector('.app .sidebar.pane');
        const footer = sidebar.querySelector('.side-footer');
        return { collapsed: sidebar.classList.contains('is-collapsed'), bg: getComputedStyle(footer).backgroundColor };
      });
      check(state.collapsed === true, 'sidebar did not collapse');
      check(state.bg === 'rgba(0, 0, 0, 0)', `collapsed .side-footer must stay background: none, not the new fill — got ${state.bg}`);
      results.push({ collapsed: state });
      await page.screenshot({ path: path.join(out, 'glass-collapsed-dark.png') });
      await page.close();
    }

    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results, errors, failures }, null, 2));
    assert.deepEqual(errors, [], `pageerrors: ${JSON.stringify(errors)}`);
    assert.deepEqual(failures, [], `${failures.length} check(s) failed:\n${failures.join('\n')}`);
    console.log(`PASS glass sticky strips (#448): ${results.length} checks — .side-footer stays legible over ${CHAT_COUNT} scrolled synthetic chats at 1440 light/dark and 768 dark, other families unaffected, collapsed sidebar unaffected. Shots in ${out}`);
  } finally { await browser.close(); await fixture.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
