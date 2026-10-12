// #1534: the "Jump to latest" pill was sticky inside the scrolling transcript, so it sat over answer
// text, tables, code headers and user bubbles as they passed beneath it. The pill now sits in a band
// of its own between the transcript and the composer, so the transcript never runs under it. The band
// is there only while the pill is shown. On a phone-sized window the composer floats; there the band
// sits just above the floating composer and the transcript stops above it.
//
// Offline: the app is built from this checkout and every API is a synthetic stub (diary-fixture.cjs).
//   PLAYWRIGHT_MODULE=<playwright-core> QA_DIST=<dist dir> node qa/chat-jump-band-1534.cjs
// Fails on a build without the change, passes with it.
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || `${process.env.HOME}/noevia-local-test/node_modules/playwright-core`);
const assert = require('node:assert/strict');
const { createFixture } = require('./diary-fixture.cjs');
const { withLocale } = require('./qa-locale.cjs');

const PORT = Number(process.env.QA_PORT || 31534);
const SHOTS = process.env.QA_SHOTS || '';
const longAnswer = 'Synthetic paragraph of answer text that runs across several lines so the reply is tall enough to scroll. '.repeat(6);
const history = [];
for (let i = 0; i < 14; i++) {
  history.push({ role: 'user', content: `Synthetic question ${i} about things.` });
  history.push({ role: 'assistant', content: `${longAnswer} ${i}`, model: 'Synthetic-Chat-Q4' });
}
const freeChats = [{ id: 'fc1', title: 'Long chat', updatedAt: 5000, archived: false, pinned: false }];

async function openLong(browser, { width, height, bodyZoom = 1 }) {
  const page = await browser.newPage(withLocale({ viewport: { width, height } }));
  await page.addInitScript(() => { localStorage.setItem('cowork-theme', 'light'); });
  await page.route('**/api/workspace', (r) => r.fulfill({ json: { projects: [], freeChats } }));
  await page.route('**/api/chats/*/history', (r) => r.fulfill({ json: { history, revision: 'r1' } }));
  await page.goto(`http://localhost:${PORT}/c/fc1`);
  await page.locator('.transcript .msg').first().waitFor({ timeout: 20000 });
  if (bodyZoom !== 1) await page.evaluate((z) => { document.body.style.zoom = String(z); }, bodyZoom);
  // Scroll up into the middle of the answers, so content passes under where the pill would sit.
  await page.evaluate(() => { const t = document.querySelector('.transcript'); t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 700); });
  await page.locator('.jump-to-latest').waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  return page;
}

const geometry = (page) => page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const pill = document.querySelector('.jump-to-latest');
  const band = pill.closest('.jump-band');
  const transcript = document.querySelector('.transcript');
  const composer = document.querySelector('.composer');
  const pr = r(pill);
  const at = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
  return {
    pillInsideTranscript: transcript.contains(pill),
    bandExists: !!band,
    transcriptBottom: Math.round(r(transcript).bottom),
    bandTop: band ? Math.round(r(band).top) : null,
    bandBottom: band ? Math.round(r(band).bottom) : null,
    composerTop: Math.round(r(composer).top),
    pillHit: !!at && (at === pill || pill.contains(at)),
    pillCount: document.querySelectorAll('.jump-to-latest').length,
  };
});

(async () => {
  const fixture = createFixture(PORT);
  await fixture.listen();
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME_PATH ? { executablePath: process.env.QA_CHROME_PATH } : { channel: 'chrome' }) });
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, null]); console.log(`PASS chat-jump-band-1534: ${name}`); }
    catch (e) { results.push([name, e]); console.log(`FAIL chat-jump-band-1534: ${name}\n  ${String(e.message).split('\n').slice(0, 8).join('\n  ')}`); }
  };
  const cases = [
    { name: 'desktop 849 px', opts: { width: 849, height: 959 }, shot: 'desk849' },
    { name: 'desktop 849 px with body zoom 1.25', opts: { width: 849, height: 959, bodyZoom: 1.25 }, shot: 'desk849zoom' },
    { name: 'phone-sized 390 px (the composer floats)', opts: { width: 390, height: 844 }, shot: 'phone390' },
  ];
  try {
    for (const c of cases) {
      await check(`#1534 ${c.name}: the pill sits in a band clear of the transcript and the composer`, async () => {
        const page = await openLong(browser, c.opts);
        const g = await geometry(page);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `jump-1534-${c.shot}.png`) });
        assert.equal(g.pillInsideTranscript, false, 'the pill is not inside the scrolling transcript');
        assert.equal(g.bandExists, true, 'the pill sits in its own band');
        assert.ok(g.transcriptBottom <= g.bandTop + 1, `the transcript ends above the band (transcript bottom ${g.transcriptBottom}, band top ${g.bandTop})`);
        assert.ok(g.bandBottom <= g.composerTop + 1, `the band ends above the composer (band bottom ${g.bandBottom}, composer top ${g.composerTop})`);
        assert.equal(g.pillHit, true, 'the pill is the element at its own centre (nothing is drawn over it)');
        assert.equal(g.pillCount, 1, 'exactly one Jump to latest control');
        await page.close();
      });
    }

    await check('#1534 activating the pill returns to the latest message and removes the band', async () => {
      const page = await openLong(browser, { width: 849, height: 959 });
      await page.locator('.jump-to-latest').click();
      await page.waitForTimeout(700);
      assert.equal(await page.locator('.jump-to-latest').count(), 0, 'the pill is gone at the bottom');
      assert.equal(await page.locator('.jump-band').count(), 0, 'the band is removed at the bottom');
      const atEnd = await page.evaluate(() => { const t = document.querySelector('.transcript'); return t.scrollHeight - t.clientHeight - t.scrollTop; });
      assert.ok(atEnd < 40, `the transcript is at its latest content (distance ${atEnd}px)`);
      await page.close();
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
  const failed = results.filter(([, e]) => e);
  console.log(`\nchat-jump-band-1534: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
