// #1716: "What happened to the new chat button?" #1529 gave the sticky New chat strip an opaque
// fill so scrolled rows stop printing through the label, but in the Glass family that fill was the
// solid menu colour, a full-bleed white (or charcoal) slab on the frosted sidebar with the rounded
// button lost inside it. New chat must sit on the sidebar's own surface in every family, keep the
// nav rows' corner and hover state, and still hide the rows that scroll beneath it.
//
// Pixel-based, so it judges what is painted, not which rule won:
//  (a) the strip adds no surface of its own: with it hidden, the sidebar beneath paints the same
//      pixels outside the icon and label (no rectangle that differs from the sidebar);
//  (b) the button has the nav rows' non-zero corner, a transparent rest state and a hover fill;
//  (c) with the list scrolled under the strip, the strip area paints the same pixels as with every
//      row hidden (no print-through, the #1529 guarantee);
//  (d) every family (editorial, contemporary, glass), light and dark, desktop 2000px and phone 390px,
//      plus the collapsed rail on desktop and Glass under reduced motion.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   npm run build -- --outDir ../dist-x
//   PLAYWRIGHT_MODULE=<playwright> QA_DIST=../dist-x [QA_SHOTS=<dir>] node qa/sidebar-new-chat-1716.cjs
// Fails on a build without the change (Glass strip is a solid slab), passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31716);
const SHOTS = process.env.QA_SHOTS || '';
const TAG = process.env.QA_TAG || 'run';
const chat = (id, title, updatedAt) => ({ id, title, updatedAt, archived: false, pinned: false });
const freeChats = Array.from({ length: 40 }, (_, i) => chat(`fc${i}`, `Synthetic recent chat ${i}`, 9000 - i));
const projects = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `Synthetic project ${i}`, pinned: false, archived: false, goal: '', instructions: '', memories: [], files: [], chats: [], createdAt: 1, updatedAt: 1, modes: ['chat'] }));
const FAMILIES = ['editorial', 'contemporary', 'glass'];
const THEMES = ['light', 'dark'];
const VIEWPORTS = [['desktop', { width: 2000, height: 900 }], ['phone', { width: 390, height: 844 }]];
const TOLERANCE = 6; // per channel, 0-255

async function decode(decoder, buf) {
  return decoder.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: Array.from(g.getImageData(0, 0, img.width, img.height).data) };
  }, buf.toString('base64'));
}
const px = (im, x, y) => { const i = (y * im.w + x) * 4; return im.data.slice(i, i + 3); };
const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

async function openSidebar(browser, { family, theme, viewport, reducedMotion = 'no-preference' }) {
  const page = await browser.newPage(withLocale({ viewport, deviceScaleFactor: 1, reducedMotion }));
  await page.addInitScript(([f, t]) => {
    localStorage.setItem('noevia:theme-family', f);
    localStorage.setItem('cowork-theme', t);
  }, [family, theme]);
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects, freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history: [], revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  await page.locator('.side-new .new-chat-btn, .nav-drawer-toggle').filter({ visible: true }).first().waitFor({ timeout: 20000 });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('.side-new .new-chat-btn').filter({ visible: true }).waitFor({ timeout: 10000 });
  await page.mouse.move(viewport.width - 5, viewport.height - 5);
  await page.waitForTimeout(450);
  return page;
}

const geometry = (page) => page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, b: b.bottom, r: b.right }; };
  const strip = document.querySelector('.side-new');
  const btn = strip.querySelector('.new-chat-btn');
  const side = strip.closest('.sidebar');
  const row = document.querySelector('.sidebar .side-nav .nav-item');
  const label = btn.querySelector('span');
  return { strip: r(strip), btn: r(btn), side: r(side), label: label && label.getBoundingClientRect().width > 1 ? r(label) : null,
    btnRadius: parseFloat(getComputedStyle(btn).borderTopLeftRadius), rowRadius: row ? parseFloat(getComputedStyle(row).borderTopLeftRadius) : null,
    btnBg: getComputedStyle(btn).backgroundColor, family: document.documentElement.dataset.family, theme: document.documentElement.dataset.theme };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const decoder = await browser.newPage();
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS sidebar-new-chat-1716: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL sidebar-new-chat-1716: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    const cases = [];
    for (const family of FAMILIES) for (const theme of THEMES) for (const [vpName, viewport] of VIEWPORTS) cases.push([family, theme, vpName, viewport, 'no-preference']);
    // Reduced motion shortens every animation to 1ms (motion.css); the scroll-driven clip must survive it.
    cases.push(['glass', 'light', 'desktop', VIEWPORTS[0][1], 'reduce'], ['glass', 'dark', 'phone', VIEWPORTS[1][1], 'reduce']);
    for (const [family, theme, vpName, viewport, reducedMotion] of cases) {
      const id = `${family} ${theme} ${vpName}${reducedMotion === 'reduce' ? ' reduced-motion' : ''}`;
      await check(`${id}: New chat sits on the sidebar's own surface, rounded like the rows, with no print-through`, async () => {
        const page = await openSidebar(browser, { family, theme, viewport, reducedMotion });
        try {
          let g = await geometry(page);
          assert.equal(g.family, family); assert.equal(g.theme, theme);
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${family}-${theme}-${viewport.width}${reducedMotion === 'reduce' ? '-reduced' : ''}.png`) });

          // (b) corner: non-zero and the nav rows' own.
          assert.ok(g.btnRadius > 0, `New chat has a rounded corner, got ${g.btnRadius}px`);
          assert.ok(g.rowRadius !== null && Math.abs(g.btnRadius - g.rowRadius) <= 0.5, `New chat's corner (${g.btnRadius}px) matches the nav rows' (${g.rowRadius}px)`);

          // (a) the strip adds no surface of its own: outside the icon and label, the strip region
          // paints the same pixels with the strip hidden (only the sidebar beneath it). A fill that
          // differs from the sidebar, as Glass's solid menu slab did, shows up here.
          const stripClip = { x: Math.floor(g.strip.x), y: Math.floor(g.strip.y), width: Math.floor(g.strip.w), height: Math.floor(g.strip.h) };
          const ink = await page.evaluate(() => {
            const btn = document.querySelector('.side-new .new-chat-btn');
            return [...btn.querySelectorAll('svg, span')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
              .map((r) => ({ x: r.left - 3, y: r.top - 3, r: r.right + 3, b: r.bottom + 3 }));
          });
          const shown = await decode(decoder, await page.screenshot({ clip: stripClip }));
          await page.addStyleTag({ content: '.side-new { visibility: hidden !important; }' });
          await page.waitForTimeout(100);
          const hidden = await decode(decoder, await page.screenshot({ clip: stripClip }));
          await page.addStyleTag({ content: '.side-new { visibility: visible !important; }' });
          let surface = 0, at = null;
          for (let yy = 0; yy < shown.h; yy++) for (let xx = 0; xx < shown.w; xx++) {
            const X = stripClip.x + xx, Y = stripClip.y + yy;
            if (ink.some((k) => X >= k.x && X <= k.r && Y >= k.y && Y <= k.b)) continue;
            const d = diff(px(shown, xx, yy), px(hidden, xx, yy));
            if (d > surface) { surface = d; at = [X, Y, px(shown, xx, yy), px(hidden, xx, yy)]; }
          }
          assert.ok(surface <= TOLERANCE, `the strip paints its own surface over the sidebar (max difference ${surface} at ${at && `${at[0]},${at[1]}: rgb(${at[2]}) vs sidebar rgb(${at[3]})`})`);

          // (b) hover gives the button its own fill.
          await page.locator('.side-new .new-chat-btn').hover();
          await page.waitForTimeout(300);
          const hover = await page.locator('.side-new .new-chat-btn').evaluate((el) => getComputedStyle(el).backgroundColor);
          assert.notEqual(hover, g.btnBg, `hover changes New chat's fill (rest ${g.btnBg}, hover ${hover})`);
          await page.mouse.move(viewport.width - 5, viewport.height - 5);
          await page.waitForTimeout(300);

          // (c) #1529: scroll rows beneath the strip; the strip region must paint exactly what it
          // paints with every row hidden.
          await page.locator('.sidebar-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
          await page.waitForTimeout(300);
          g = await geometry(page);
          const under = await page.evaluate(() => {
            const strip = document.querySelector('.side-new').getBoundingClientRect();
            return [...document.querySelectorAll('.sidebar-scroll :is(.nav-item, .section-label, .chat-row, .proj-row, .side-logo)')]
              .filter((el) => !el.closest('.side-new')).map((el) => el.getBoundingClientRect())
              .filter((b) => b.width > 0 && b.top < strip.bottom - 4 && b.bottom > strip.top + 4).length;
          });
          assert.ok(under > 0, 'a row really passes beneath the strip (the check is meaningful)');
          const clip = { x: Math.floor(g.strip.x), y: Math.max(0, Math.floor(g.strip.y)), width: Math.floor(g.strip.w), height: Math.floor(g.strip.b - Math.max(0, g.strip.y)) };
          const withRows = await decode(decoder, await page.screenshot({ clip }));
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${family}-${theme}-${viewport.width}${reducedMotion === 'reduce' ? '-reduced' : ''}-scrolled.png`) });
          await page.addStyleTag({ content: '.sidebar-scroll > :not(.side-new), .sidebar-scroll > :not(.side-new) * { visibility: hidden !important; }' });
          await page.waitForTimeout(100);
          const without = await decode(decoder, await page.screenshot({ clip }));
          let worst = 0;
          for (let i = 0; i < withRows.data.length; i += 4) worst = Math.max(worst, diff(withRows.data.slice(i, i + 3), without.data.slice(i, i + 3)));
          assert.ok(worst <= TOLERANCE, `rows beneath the strip print through it (max pixel difference ${worst})`);
        } finally { await page.close(); }
      });
    }

    // Collapsed rail (desktop): New chat is an icon button with the rows' corner and no slab.
    for (const family of FAMILIES) for (const theme of THEMES) {
      await check(`${family} ${theme} collapsed rail: New chat keeps the rows' corner on the sidebar surface`, async () => {
        const viewport = VIEWPORTS[0][1];
        const page = await openSidebar(browser, { family, theme, viewport });
        try {
          await page.locator('.sidebar .side-expand').click();
          await page.locator('.sidebar.is-collapsed').waitFor();
          await page.waitForTimeout(450);
          const g = await geometry(page);
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-${family}-${theme}-${viewport.width}-collapsed.png`) });
          assert.ok(g.btnRadius > 0, `collapsed New chat has a rounded corner, got ${g.btnRadius}px`);
          const shot = await decode(decoder, await page.screenshot());
          const yb = Math.round(g.btn.y + 3);
          const a = px(shot, Math.round(g.btn.x + 3), yb), b = px(shot, Math.round(g.btn.x - 2), yb);
          assert.ok(g.btn.x - 2 > g.side.x, 'sidebar surface beside the collapsed button');
          assert.ok(diff(a, b) <= TOLERANCE, `collapsed New chat corner rgb(${a}) differs from the sidebar rgb(${b})`);
        } finally { await page.close(); }
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nsidebar-new-chat-1716: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
