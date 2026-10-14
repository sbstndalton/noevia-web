// #1527 (narrow and tall aspect ratios): the engine metrics strip under the composer and the two panels
// it opens (the "more" metrics popover and the routing details) must stay usable at every window shape,
// not only the desktop sizes strip-layout-1527.cjs covers. At each size, light and dark, with full
// metrics and with the "still measuring" values a Retry shows:
//  - the strip is one row inside the composer column, nothing clipped, no horizontal page scroll;
//  - an open panel sits wholly inside the viewport, never covers the text box or the send button,
//    keeps each label on one line (no "Mea / suring" word breaks) and scrolls inside itself when the
//    window is too short rather than running off the top.
// Offline: the app is built from this checkout and every API is a synthetic stub.
//
// Fails on a build without the change, passes with it:
//   npm run build -- --outDir ../dist-before   (the parent commit)
//   QA_DIST=../dist-before node qa/metrics-aspect-1527.cjs   -> exits 1
//   npm run build && node qa/metrics-aspect-1527.cjs          -> exits 0
// Environment: PLAYWRIGHT_MODULE, QA_CHROME_PATH (else channel chrome), QA_DIST, QA_PORT (31528),
//              QA_SCREENSHOTS (screenshots are written only when set).
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = Number(process.env.QA_PORT || 31528);
const SHOTS = process.env.QA_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const SIZES = [[390, 844], [320, 700], [390, 1400], [600, 1400], [849, 1600], [1024, 1366], [2000, 1250], [2000, 560], [849, 959]];
const THEMES = ['light', 'dark'];
const ROUTE = { offered: [{ id: 'code', label: 'Synthetic code model' }, { id: 'fast', label: 'Synthetic fast model with a long description that wraps' }],
  scores: { code: 0.82, fast: 0.4 }, selectedRole: 'code', effectiveRole: 'code', backend: 'decision-service',
  model: 'convaiinnovations/laya', calibrated: false, latencyMs: 1943, status: 'accepted', fallbackReason: null };
const FULL = { up: true, tokensPerSecond: 40.3, timeToFirstToken: 0.42, inputTokens: 4600, outputTokens: 669, inputTokensTotal: 52000,
  outputTokensTotal: 9000, requestCount: 31, gpuPercent: null, vramGb: null,
  mtp: [{ model: 'Synthetic-draft', source: 'engine total', rate: 0.78, drafted: 100, accepted: 78 }] };
const PENDING = { up: true };

async function openChat(browser, { width, height, theme, stats }) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 500, isMobile: width < 500 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((t) => { try { localStorage.setItem('cowork-theme', t); } catch { /* ignore */ } }, theme);
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/stats') return route.fulfill(json(stats));
    if (/\/history$/.test(p)) return route.fulfill(json({ revision: 'r1', history: [
      { role: 'user', content: 'Synthetic question.' },
      { role: 'assistant', content: 'Synthetic answer.', model: 'Synthetic-Chat-Q4', routingDecision: ROUTE,
        stats: { elapsedMs: 4100, promptTokens: 10, completionTokens: 90, totalTokens: 100, tokensPerSecond: 40.3 } }] }));
    if (/\/context$/.test(p)) return route.fulfill(json({ project: null, freeContext: null }));
    if (p === '/api/setup/status') return route.fulfill(json({ configured: true, publicOrigin: `http://localhost:${PORT}` }));
    if (p === '/api/features') return route.fulfill(json({ flags: {} }));
    if (p === '/api/profile' || p === '/api/auth/session') return route.fulfill(json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic', role: 'admin', onboarded: true, diaryEnabled: false }, passkeys: [] }));
    if (p === '/api/chats') return route.fulfill(json({ chats: [{ id: 'c-1', title: 'Synthetic chat', updatedAt: Date.now() }] }));
    return route.fulfill(json({}));
  });
  await page.goto(`http://localhost:${PORT}/c/c-1`);
  await page.locator('.composer').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await page.waitForTimeout(300);
  return page;
}

// Geometry of an open panel against the viewport and the composer's own controls.
const panelGeometry = (page, selector) => page.evaluate((sel) => {
  const panel = document.querySelector(sel);
  if (!panel) return null;
  const b = panel.getBoundingClientRect();
  const hit = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
    return r.width > 0 && !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom); };
  const input = document.querySelector('.composer textarea, .composer [contenteditable="true"]');
  const send = document.querySelector('.composer .send-btn, .composer button[type="submit"], .composer button[aria-label*="Send" i]');
  const brokenLabels = [...panel.querySelectorAll('dt, .stats-label, summary')].filter((el) => {
    if (!el.offsetParent) return false;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
    const words = (el.textContent || '').trim().split(/\s+/).length;
    return el.getBoundingClientRect().height > lh * Math.max(1, words) * 0.75 + lh * 0.6 && el.getBoundingClientRect().height > lh * 1.6;
  }).map((el) => el.textContent.trim());
  const overflowsWithoutScroll = panel.scrollHeight > panel.clientHeight + 1 && !/(auto|scroll)/.test(getComputedStyle(panel).overflowY);
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right),
    vw: innerWidth, vh: innerHeight, coversInput: hit(input), coversSend: hit(send), brokenLabels, overflowsWithoutScroll };
}, selector);

const stripGeometry = (page) => page.evaluate(() => {
  const strip = document.querySelector('.stats-disclosure.is-wide');
  if (!strip || !strip.offsetParent) return null;
  const b = strip.getBoundingClientRect();
  const truncated = [...strip.querySelectorAll('.stats-bar-static dd, .stats-bar-static .stats-label')].filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
  return { height: Math.round(b.height), left: b.left, right: b.right, pageScrollX: document.documentElement.scrollWidth - innerWidth, truncated };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const failures = [];
  let passed = 0;
  const check = (name, ok, detail) => { if (ok) passed++; else { failures.push(`${name}: ${detail}`); console.log(`FAIL ${name}: ${detail}`); } };
  try {
    for (const [width, height] of SIZES) for (const theme of THEMES) for (const [kind, stats] of [['full', FULL], ['pending', PENDING]]) {
      const at = `${width}x${height} ${theme} ${kind}`;
      const page = await openChat(browser, { width, height, theme, stats });
      const s = await stripGeometry(page);
      // Phone widths keep the metrics in the model sheet (qa/phone-composer-527.cjs); a short window hides the strip.
      if (!s) { console.log(`skip ${at}: no wide strip at this size (phone sheet or short window)`); await page.close(); continue; }
      check(`${at} strip is one row`, s.height <= 44, `${s.height}px tall`);
      check(`${at} no horizontal page scroll`, s.pageScrollX <= 0, `${s.pageScrollX}px`);
      check(`${at} strip inside the viewport`, s.left >= 0 && s.right <= width + 1, `${Math.round(s.left)}..${Math.round(s.right)}`);
      check(`${at} strip values whole`, !s.truncated.length, s.truncated.join(' | '));
      if (SHOTS && kind === 'full' && (width === 2000 || width === 390) ) await page.screenshot({ path: path.join(SHOTS, `strip-${width}x${height}-${theme}.png`) });
      for (const [panelName, opener, selector] of [['metrics', '.stats-more', '.stats-details'], ['routing', '.stats-disclosure .routing-details summary', '.stats-disclosure .routing-details[open]']]) {
        const btn = page.locator(opener).first();
        if (!(await btn.isVisible().catch(() => false))) continue;
        await btn.click();
        await page.waitForTimeout(150);
        const g = await panelGeometry(page, selector);
        if (!g) { check(`${at} ${panelName} opens`, false, 'no panel'); continue; }
        check(`${at} ${panelName} inside the viewport`, g.top >= 0 && g.left >= 0 && g.right <= g.vw + 1 && g.bottom <= g.vh + 1, `box ${g.left},${g.top}..${g.right},${g.bottom} in ${g.vw}x${g.vh}`);
        check(`${at} ${panelName} leaves the text box clear`, !g.coversInput, 'covers the text box');
        check(`${at} ${panelName} leaves Send clear`, !g.coversSend, 'covers the send button');
        check(`${at} ${panelName} labels stay on one line`, !g.brokenLabels.length, g.brokenLabels.join(' | '));
        check(`${at} ${panelName} scrolls inside when too tall`, !g.overflowsWithoutScroll, 'content runs past the panel');
        if (SHOTS && kind === 'full' && (width === 2000 || width === 390)) await page.screenshot({ path: path.join(SHOTS, `${panelName}-${width}x${height}-${theme}.png`) });
        await page.keyboard.press('Escape');
        if (await page.locator(selector).count()) await btn.click().catch(() => {});
        await page.waitForTimeout(100);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await fixture.close?.();
  }
  console.log(`\nmetrics-aspect-1527: ${passed}/${passed + failures.length} checks passed${SHOTS ? `, screenshots in ${SHOTS}` : ''}`);
  process.exit(failures.length ? 1 : 0);
})();
