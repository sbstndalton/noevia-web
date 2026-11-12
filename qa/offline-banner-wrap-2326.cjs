'use strict';
// sbstndalton/noevia#2326: at 375 px the inference-unreachable banner left its closing period alone on a third line, after the
// Settings link. The link and the punctuation that closes the sentence now wrap together. Mocked /api/health (inferenceUp:false).
// Fails on a build of main, passes with the change. 375 and 768 px, light and dark; a few widths around 375 where the wrap moves.
const assert = require('node:assert/strict');
const { VIEWS, themedPage, shot, run } = require('./ui-batch-harness.cjs');

/** The closing "." of the banner and the Settings link, as lines: where the period sits against the link's last line. */
const lineOfPeriod = (page) => page.evaluate(() => {
  const banner = document.querySelector('.conn-banner'), link = banner.querySelector('.conn-banner-link');
  const walker = document.createTreeWalker(banner, NodeFilter.SHOW_TEXT);
  let last = null; for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim()) last = n;
  const text = last.textContent, at = text.lastIndexOf('.');
  const range = document.createRange(); range.setStart(last, at); range.setEnd(last, at + 1);
  const dot = range.getClientRects()[0], rects = [...link.getClientRects()], tail = rects[rects.length - 1];
  return { dotTop: dot.top, linkLastTop: tail.top, lineHeight: tail.height, bannerText: banner.textContent };
});

async function open(browser, origin, view) {
  const page = await themedPage(browser, view);
  await page.route('**/api/health', (r) => r.fulfill({ json: { inferenceUp: false, diaryUp: true } }));
  await page.goto(origin);
  await page.locator('.conn-banner').waitFor({ timeout: 20000 });
  return page;
}

run('offline-banner-wrap-2326', Number(process.env.QA_PORT || 32326), async (check, browser, origin) => {
  for (const view of VIEWS) {
    await check(`${view[0]} px ${view[2]}: the closing period stays on the Settings link's line`, async () => {
      const page = await open(browser, origin, view);
      try {
        const m = await lineOfPeriod(page);
        assert.ok(Math.abs(m.dotTop - m.linkLastTop) < m.lineHeight / 2, `the period is on its own line (period top ${m.dotTop}, link line top ${m.linkLastTop})`);
        await shot(page, `offline-banner-${view[0]}-${view[2]}`);
      } finally { await page.close(); }
    });
  }
  // The wrap point moves with the width: sweep so the check does not pass only because 375 happens to break elsewhere.
  await check('no width from 320 to 420 px leaves the period alone', async () => {
    const page = await open(browser, origin, [375, 812, 'light']);
    try {
      for (let width = 320; width <= 420; width += 4) {
        await page.setViewportSize({ width, height: 812 });
        const m = await lineOfPeriod(page);
        assert.ok(Math.abs(m.dotTop - m.linkLastTop) < m.lineHeight / 2, `${width} px: the period is on its own line`);
      }
    } finally { await page.close(); }
  });
});
