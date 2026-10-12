// #1527 (owner, 2026-10-12): the inference strip under the composer must be one row that never
// wraps or clips, and must keep its values whole at the owner's desktop size. Where the row cannot hold every pair, the low-priority
// pairs sit behind a compact toggle that opens an aligned popover. Offline: the app is built from
// this checkout and every API is a synthetic stub; nothing reaches a real server.
//
// Fails on a build without the change, passes with it.
//   npm run build -- --outDir ../dist-before        (or any build of the parent commit)
//   npm run build -- --outDir ../dist-after
//   PLAYWRIGHT_MODULE=<playwright-core> QA_CHROME_PATH=<Chrome> QA_DIST=../dist-after node qa/strip-layout-1527.cjs
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${os.homedir()}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');

const PORT = Number(process.env.QA_PORT || 31527);
const SHOTS = process.env.QA_SHOTS || '';

const ROUTE = {
  offered: [{ id: 'code', label: 'Synthetic code model' }, { id: 'fast', label: 'Synthetic fast model' }],
  scores: { code: 0.82, fast: 0.4 }, selectedRole: 'code', effectiveRole: 'code', backend: 'decision-service',
  model: 'convaiinnovations/laya', calibrated: false, latencyMs: 35, status: 'accepted', fallbackReason: null,
};

function history(withRoute) {
  return [
    { role: 'user', content: 'Synthetic question.' },
    { role: 'assistant', content: 'Synthetic answer.', model: 'Synthetic-Chat-Q4', ...(withRoute ? { routingDecision: ROUTE } : {}),
      stats: { elapsedMs: 4100, promptTokens: 10, completionTokens: 90, totalTokens: 100, tokensPerSecond: 40.3 } },
  ];
}

// Every pair has a value; the engine reports a draft-model acceptance so the widest pair is present.
const STATS = { up: true, tokensPerSecond: 40.3, timeToFirstToken: 0.42, inputTokens: 1400, outputTokens: 144,
  inputTokensTotal: 52000, outputTokensTotal: 9000, requestCount: 31, gpuPercent: null, vramGb: null,
  mtp: [{ model: 'Synthetic-draft', source: 'engine total', rate: 0.78, drafted: 100, accepted: 78 }] };

async function stub(page, withRoute) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/stats') return route.fulfill(json(STATS));
    if (/\/history$/.test(p)) return route.fulfill(json({ history: history(withRoute), revision: 'r1' }));
    if (/\/context$/.test(p)) return route.fulfill(json({ project: null, freeContext: null }));
    if (p === '/api/setup/status') return route.fulfill(json({ configured: true, publicOrigin: `http://localhost:${PORT}` }));
    if (p === '/api/features') return route.fulfill(json({ flags: {} }));
    if (p === '/api/profile' || p === '/api/auth/session') return route.fulfill(json({ user: { id: 'qa', username: 'admin', displayName: 'Synthetic', role: 'admin', onboarded: true, diaryEnabled: false }, passkeys: [] }));
    if (p === '/api/chats') return route.fulfill(json({ chats: [{ id: 'c-1', title: 'Synthetic chat', updatedAt: Date.now() }] }));
    return route.fulfill(json({}));
  });
}

async function openChat(browser, { width, height, withRoute }) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => { try { localStorage.setItem('cowork-theme', 'dark'); } catch { /* ignore */ } });
  await stub(page, withRoute);
  await page.goto(`http://localhost:${PORT}/c/c-1`);
  await page.locator('.stats-disclosure .stats-bar-static').waitFor({ timeout: 20000 });
  await page.locator('.stats-details').waitFor();
  await page.waitForTimeout(300);
  return page;
}

// Geometry of the strip as the user sees it: one row, nothing outside the card, nothing scrolling inside.
const measure = (page) => page.evaluate(() => {
  const strip = document.querySelector('.stats-disclosure');
  const box = strip.getBoundingClientRect();
  const visible = (el) => !!el.offsetParent || getComputedStyle(el).position === 'fixed';
  const pairs = [...document.querySelectorAll('.stats-details > div')].filter((el) => getComputedStyle(el).display !== 'none');
  const tops = [...new Set(pairs.flatMap((el) => [...el.querySelectorAll('dt')].map((dt) => Math.round(dt.getBoundingClientRect().top))))];
  const outside = [...strip.querySelectorAll('*')].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && (b.right > box.right + 1 || b.left < box.left - 1);
  }).map((el) => el.className?.baseVal ?? el.className);
  const scrollers = [...strip.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX + cs.overflowY) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  }).map((el) => el.className?.baseVal ?? el.className);
  const list = strip.querySelector('.stats-details');
  const listBox = list.getBoundingClientRect();
  // A pair the list cannot hold is clipped by the list's own edge, not by its value, so check the pairs too.
  const clipped = pairs.filter((el) => el.getBoundingClientRect().right > listBox.right + 1).map((el) => el.dataset.stat);
  const truncated = [...strip.querySelectorAll('dd, .stats-label')].filter((el) => getComputedStyle(el).display !== 'none' && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
  return {
    height: Math.round(box.height), left: box.left, right: box.right, rowTops: tops.length,
    composerTop: Math.round(document.querySelector('.composer').getBoundingClientRect().top),
    outside, scrollers, truncated, clipped, visible: visible(strip),
    toggleShown: !!document.querySelector('.stats-more') && getComputedStyle(document.querySelector('.stats-more')).display !== 'none',
    lowShown: [...document.querySelectorAll('.stats-details > div[data-priority="low"]')].filter((el) => getComputedStyle(el).display !== 'none').length,
    pairsShown: pairs.length,
  };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS strip-1527: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL strip-1527: ${name}\n  ${String(e.message).split('\n').slice(0, 6).join('\n  ')}`); }
  };
  try {
    await check('#1527 at the owner\'s desktop size (849x959) the strip is one row with nothing clipped or scrolling', async () => {
      const page = await openChat(browser, { width: 849, height: 959, withRoute: true });
      const m = await measure(page);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'strip-849x959.png') });
      assert.equal(m.visible, true);
      assert.ok(m.height <= 44, `strip is one row tall, got ${m.height}px`);
      assert.equal(m.rowTops, 1, 'every visible label sits on one line');
      assert.deepEqual(m.outside, [], 'nothing reaches past the card edge');
      assert.deepEqual(m.scrollers, [], 'no inner scrollbar');
      assert.deepEqual(m.truncated, [], 'the values are whole');
      assert.deepEqual(m.clipped, [], 'no pair is cut by the edge of the list');
      await page.close();
    });

    await check('#1527 at a narrower desktop (790px) the lower-priority pairs sit behind the toggle, and the toggle is shown', async () => {
      const page = await openChat(browser, { width: 790, height: 900, withRoute: true });
      const m = await measure(page);
      assert.equal(m.toggleShown, true, 'the compact toggle is shown');
      assert.equal(m.lowShown, 0, 'no low-priority pair is in the row');
      assert.ok(m.height <= 44, `still one row, got ${m.height}px`);
      assert.deepEqual(m.scrollers, [], 'no inner scrollbar');
      assert.deepEqual(m.truncated, [], 'the speed value is whole');
      assert.deepEqual(m.clipped, [], 'the speed pair is not cut by the edge of the list');
      await page.close();
    });

    await check('#1527 the toggle opens every pair in one aligned popover above the strip; Escape closes it and returns focus', async () => {
      const page = await openChat(browser, { width: 790, height: 900, withRoute: true });
      const toggle = page.locator('.stats-more');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      const details = page.locator('.stats-details');
      const shown = await page.locator('.stats-details > div').evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none').length);
      assert.equal(shown, 6, 'all six pairs are shown in the popover');
      const labelLeft = await page.locator('.stats-details dt').evaluateAll((els) => [...new Set(els.filter((el) => el.offsetParent).map((el) => Math.round(el.getBoundingClientRect().left)))]);
      assert.equal(labelLeft.length, 1, 'labels share one left edge');
      const valueLeft = await page.locator('.stats-details dd').evaluateAll((els) => [...new Set(els.filter((el) => el.offsetParent).map((el) => Math.round(el.getBoundingClientRect().left)))]);
      assert.equal(valueLeft.length, 1, 'values share one left edge');
      const popBox = await details.boundingBox(), stripBox = await page.locator('.stats-disclosure').boundingBox();
      assert.ok(popBox.y + popBox.height <= stripBox.y + 1, 'the popover opens above the strip, not into it');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'strip-790x900-open.png') });
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Escape closes it');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('stats-more')), true, 'focus returns to the toggle');
      await page.close();
    });

    await check('#1527 at a wide desktop (1920x1080) every pair is in the row and there is no toggle', async () => {
      const page = await openChat(browser, { width: 1920, height: 1080, withRoute: true });
      const m = await measure(page);
      assert.equal(m.toggleShown, false, 'no toggle when the row holds everything');
      assert.equal(m.pairsShown, 6, 'all six pairs are in the row');
      assert.ok(m.height <= 44, `one row, got ${m.height}px`);
      assert.deepEqual(m.truncated, [], 'nothing is cut short');
      assert.deepEqual(m.clipped, [], 'no pair is cut by the edge of the list');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'strip-1920x1080.png') });
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nstrip-1527: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
